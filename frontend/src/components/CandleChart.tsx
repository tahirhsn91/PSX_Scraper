import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import {
  createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import type { CandleSeries, HistoryRange } from '../types';

/**
 * Daily candles for one symbol, drawn with TradingView's open-source charting library
 * (Apache-2.0) over *our* stored data — nothing is fetched from TradingView here.
 *
 * The range buttons are a *viewport*, not a filter. The chart always holds every session we
 * have for the symbol, and a preset moves the visible window (1W … MAX). That is what lets you
 * drag or scroll backwards past the selected range and keep reading real candles instead of
 * empty space; fetching only the range would leave nothing behind the left edge. It also makes
 * the buttons instant, because switching a range no longer refetches anything.
 *
 * Rendering rule for incomplete candles, because our two data sources each report half: the
 * historical EOD feed gives open + close + volume with no high/low, and the live quote gives
 * high/low + close + volume with no open. The API reports those gaps as nulls rather than
 * filling them, so what happens here is a drawing decision, not invented data:
 *
 *  - no high/low -> the wick collapses onto the body (high = max(open, close),
 *    low = min(open, close)). The day's move is honest; the wick is simply not claimed.
 *  - no open -> the body is drawn flat at the close. "Open unknown" renders as a line rather
 *    than pretending the day opened where it closed.
 *
 * Candles the API dropped as impossible for this symbol (see `buildCandles` on the backend)
 * leave a gap, which is the honest thing to show.
 *
 * The chart is built imperatively, so it is *stateful across React remounts*: in development
 * React 18 mounts, unmounts and remounts every component, which destroys the chart and its
 * series. A data effect keyed on `data` would then never re-run (its dependency has not
 * changed), leaving the new, empty series on screen. So the latest data lives in a ref and is
 * drawn whenever a chart is (re)built, not only when the data changes.
 */
export function CandleChart({
  data,
  range,
  height = 380,
}: {
  data: CandleSeries | undefined;
  range: HistoryRange;
  height?: number;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const dataRef = useRef<CandleSeries | undefined>(data);
  /** Which preset the current view is showing, so a redraw does not yank a panned view back. */
  const appliedRef = useRef<HistoryRange | null>(null);
  dataRef.current = data;

  /** Days of history a preset should show. MAX means the whole series. */
  const daysFor = (preset: HistoryRange): number | null =>
    ({ '1W': 7, '1M': 30, '6M': 182, '1Y': 365, '3Y': 1095, '5Y': 1825, MAX: null } as Record<HistoryRange, number | null>)[preset];

  const draw = (series: CandleSeries | undefined, preset: HistoryRange, force: boolean) => {
    if (!candleRef.current || !volumeRef.current || !chartRef.current) return;
    const items = series?.items ?? [];
    candleRef.current.setData(items.map((c) => {
      const open = c.open ?? c.close;
      return {
        time: c.time as unknown as UTCTimestamp,
        open,
        high: c.high ?? Math.max(open, c.close),
        low: c.low ?? Math.min(open, c.close),
        close: c.close,
      };
    }));
    volumeRef.current.setData(items.map((c) => ({
      time: c.time as unknown as UTCTimestamp,
      value: c.volume ?? 0,
      color: c.close >= (c.open ?? c.close) ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
    })));
    if (items.length === 0) return;

    // Move the viewport only when the preset changed (or on first draw) — not on every data
    // refresh, or a view the user scrolled back would snap forward again.
    if (!force && appliedRef.current === preset) return;
    const last = items[items.length - 1]!.time;
    const days = daysFor(preset);
    let from = items[0]!.time;
    if (days !== null) {
      const cutoff = new Date(new Date(`${last}T00:00:00Z`).getTime() - days * 86400000)
        .toISOString()
        .slice(0, 10);
      // Clamp into the data we actually hold: a 5Y window on a two-year-old listing starts at
      // its first session rather than demanding candles that do not exist.
      from = [...items].reverse().find((c) => c.time <= cutoff)?.time ?? items[0]!.time;
    }
    chartRef.current.timeScale().setVisibleRange({ from: from as never, to: last as never });
    appliedRef.current = preset;
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // autoSize lets the library watch its own container, so the chart cannot be built at a
    // zero width before layout settles.
    const chart = createChart(el, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9e9e9e',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(128,128,128,0.12)' },
        horzLines: { color: 'rgba(128,128,128,0.12)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false },
      // Panning back through history is the point of this chart, so it stays enabled;
      // the vertical price scale is fixed to the data instead of to the window.
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    candleRef.current = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    // Whatever data we already hold goes in immediately: the data effect below will not fire
    // again just because the chart was rebuilt.
    appliedRef.current = null;
    draw(dataRef.current, range, true);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      appliedRef.current = null;
    };
  }, [height]);

  // Data arriving (or a refresh) redraws the series but leaves the viewport where it is.
  useEffect(() => {
    draw(data, range, false);
  }, [data]);

  // Choosing a range moves the window.
  useEffect(() => {
    draw(dataRef.current, range, true);
  }, [range]);

  if (data && data.items.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No candles for {data.symbol} yet — this symbol has no stored session history.
        </Typography>
      </Box>
    );
  }

  return <Box ref={boxRef} sx={{ width: '100%', height }} />;
}
