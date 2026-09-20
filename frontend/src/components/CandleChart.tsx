import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import {
  createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import type { CandleSeries } from '../types';

/**
 * Daily candles for one symbol, drawn with TradingView's open-source charting library
 * (Apache-2.0) over *our* stored data — nothing is fetched from TradingView here.
 *
 * Rendering rule for incomplete candles, because our two data sources each report half:
 * the historical EOD feed gives open + close + volume with no high/low, and the live quote
 * gives high/low + close + volume with no open. The API reports those gaps as nulls rather
 * than filling them, so what happens here is a drawing decision, not invented data:
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
 * changed), leaving the new, empty series on screen — which is exactly what happened. So the
 * latest data lives in a ref and is drawn whenever a chart is (re)built, not only when the
 * data changes.
 */
export function CandleChart({ data, height = 380 }: { data: CandleSeries | undefined; height?: number }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const dataRef = useRef<CandleSeries | undefined>(data);
  dataRef.current = data;

  const draw = (series: CandleSeries | undefined) => {
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
    chartRef.current.timeScale().fitContent();
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
    draw(dataRef.current);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    draw(data);
  }, [data]);

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
