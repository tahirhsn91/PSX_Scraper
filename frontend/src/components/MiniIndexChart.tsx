import { useMemo } from 'react';
import { Box, Skeleton, Tooltip, Typography, useTheme } from '@mui/material';
import { useIndexHistory } from '../api/hooks';
import { toCandles, toneOf, type MiniCandle } from '../lib/candles';

/**
 * The small chart in an index card, drawn from that index's own sessions.
 *
 * Two shapes, one series: `line` is the smooth sparkline the card uses, `candles` draws the same
 * sessions as open→close bodies for callers that want them. Either way each index draws its own
 * shape — seventeen cards showing the same curve would mean seventeen identical series, not one
 * drawing reused.
 *
 * Its own SVG rather than the charting library: seventeen of these draw at once in a card, where a
 * canvas each is all overhead and no detail.
 *
 * What the data does not have, the chart does not invent: the exchange publishes no high or low for
 * indices at all, so there are no wicks on the candle variant, and we hold no intraday series, so
 * neither variant has intraday bars. A session without a published open is built from the previous
 * session's close to its own close — the day's real net move — rather than from an invented open.
 */

/** The sparkline's box, in CSS pixels. Fixed so cards on a row stay the same height. */
const LINE = { w: 120, h: 46 };

/** The candle variant's box. */
const CANDLES = { h: 44 };

const level = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const longDay = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * A smooth path through the points: straight segments between candles would read as a histogram,
 * and the card's sparkline is meant to show the shape of the move at a glance.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  return points.reduce((path, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1];
    const midX = (prev.x + point.x) / 2;
    return `${path} C ${midX} ${prev.y} ${midX} ${point.y} ${point.x} ${point.y}`;
  }, '');
}

/**
 * Hover detail. Kept short on purpose: a card in a dense grid must not have its neighbours covered
 * to explain itself. High and low are named as unpublished rather than shown as dashes, because a
 * dash next to a value reads as "zero today" and this is "never published".
 */
function Detail({ symbol, candles }: { symbol: string; candles: MiniCandle[] }) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const pct = prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : null;
  return (
    <Box sx={{ py: 0.25 }}>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
        {symbol} · {longDay(last.date)}
        {last.live ? ' · forming' : ''}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block' }}>
        close {level(last.close)} · open {level(last.open)}
      </Typography>
      {pct !== null && (
        <Typography variant="caption" sx={{ display: 'block' }}>
          {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}% on the session
        </Typography>
      )}
      {last.volume !== null && (
        <Typography variant="caption" sx={{ display: 'block' }}>
          volume {last.volume.toLocaleString()}
        </Typography>
      )}
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.7 }}>
        high/low not published for indices
      </Typography>
    </Box>
  );
}

export function MiniIndexChart({
  symbol,
  sessions = 28,
  variant = 'line',
  flat = false,
  width,
  fullWidth = false,
}: {
  symbol: string;
  /**
   * How many sessions to draw. A shorter window means each candle's body carries more of the box:
   * daily index moves are a few tenths of a percent against a window range of a few percent, so
   * forty sessions draws a ribbon where twenty-eight draws a shape.
   */
  sessions?: number;
  variant?: 'line' | 'candles';
  /** Today's move is not meaningful — the chart goes neutral rather than forcing a tone. */
  flat?: boolean;
  /**
   * Draw wider than the default box. The height stays 46px, so a wider chart shows the same 28
   * sessions with more horizontal room between them rather than more of the series. Used by the
   * headline card, which is twice the width of the rest and has the space to spend.
   */
  width?: number;
  /**
   * Span whatever the parent gives, instead of the fixed box. Used by the headline card, where the
   * chart runs along the foot of the card: the sessions stay the same, the horizontal room does not.
   */
  fullWidth?: boolean;
}) {
  const theme = useTheme();
  const { data, isLoading } = useIndexHistory(symbol, sessions);
  const candles = useMemo(() => toCandles(data?.items ?? [], sessions), [data, sessions]);

  /**
   * Resolve a palette token to the colour to paint with. SVG children take paint as an attribute
   * rather than through `sx`, so the token is looked up here instead of in the markup — the chart
   * still draws from the theme, and so still follows light and dark.
   */
  const ink = (token: ReturnType<typeof toneOf>) => {
    if (token === 'success.main') return theme.palette.success.main;
    if (token === 'error.main') return theme.palette.error.main;
    return theme.palette.text.disabled;
  };

  const box = variant === 'line' ? { w: width ?? LINE.w, h: LINE.h } : { w: width ?? 100, h: CANDLES.h };
  /** The box's own width unless the caller wants the chart to span its parent. */
  const cssWidth = fullWidth ? '100%' : box.w;

  if (isLoading && candles.length === 0) {
    return <Skeleton variant="rounded" sx={{ width: cssWidth, height: box.h }} />;
  }

  // No series, no chart: an empty frame keeps the card's height and claims nothing. Drawing a shape
  // here would be the one thing this component must never do.
  if (candles.length < 2) {
    return (
      <Box
        sx={{
          width: cssWidth,
          height: box.h,
          display: 'grid',
          placeItems: 'center',
          borderBottom: '1px dashed',
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.disabled">
          no sessions
        </Typography>
      </Box>
    );
  }

  const values = candles.flatMap((c) => [c.open, c.close]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || max || 1) * 0.08;
  const lo = min - pad;
  const hi = max + pad;
  const y = (value: number) => box.h - ((value - lo) / (hi - lo)) * box.h;

  const last = candles[candles.length - 1];
  const slot = box.w / candles.length;
  const colour = ink(toneOf(last, flat));

  /**
   * The latest-close marker is a positioned DOM dot rather than an SVG circle: the chart's viewBox
   * is stretched to fill its box, and that non-uniform stretch renders a circle inside it as an
   * ellipse whenever the rendered width is not the box's aspect. A DOM element is not part of that
   * transform, so the dot stays round on every card.
   */
  const markerLeft = ((candles.length - 0.5) / candles.length) * 100;
  const markerTop = (y(last.close) / box.h) * 100;

  return (
    <Tooltip arrow placement="top" title={<Detail symbol={symbol} candles={candles} />}>
      <Box sx={{ position: 'relative', width: cssWidth, height: box.h, flexShrink: 0 }}>
      <Box
        component="svg"
        viewBox={`0 0 ${box.w} ${box.h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${symbol}: ${candles.length} sessions, latest session ${
          flat ? 'unchanged' : last.close >= last.open ? 'up' : 'down'
        }`}
        sx={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}
      >
        {variant === 'line' ? (
          (() => {
            const points = candles.map((c, i) => ({ x: i * slot + slot / 2, y: y(c.close) }));
            const line = smoothPath(points);
            // A flat low-opacity wash under the path — not a gradient — so the shape reads as a
            // filled series rather than a stray thread, without the decoration the theme avoids.
            const area = `${line} L ${points[points.length - 1].x} ${box.h} L ${points[0].x} ${box.h} Z`;
            return (
              <>
                <path d={area} fill={colour} fillOpacity={0.12} stroke="none" />
                {/* The whole path follows the index, so a card cannot show a trend the index did
                    not have — but the stroke takes today's tone, which is what the card answers. */}
                <path
                  d={line}
                  fill="none"
                  stroke={colour}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            );
          })()
        ) : (
          <>
            {candles.map((candle, i) => {
              const top = Math.min(y(candle.open), y(candle.close));
              const height = Math.max(0.6, Math.abs(y(candle.close) - y(candle.open)));
              const bodyWidth = Math.max(0.7, Math.min(slot * 0.62, 3.2));
              return (
                <rect
                  key={candle.date || i}
                  x={i * slot + (slot - bodyWidth) / 2}
                  y={top}
                  width={bodyWidth}
                  height={height}
                  fill={ink(toneOf(candle, flat))}
                  // The newest session is still forming, so it is drawn a shade lighter than the
                  // closed ones — visible as "in progress" without animating or glowing.
                  opacity={candle.live ? 0.65 : 1}
                />
              );
            })}
            <line
              x1={0}
              x2={box.w}
              y1={y(last.close)}
              y2={y(last.close)}
              stroke={theme.palette.text.secondary}
              strokeOpacity={0.32}
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <rect x={box.w - 1.6} y={y(last.close) - 1.6} width={3.2} height={3.2} fill={colour} />
          </>
        )}
      </Box>
      {variant === 'line' && (
        <Box
          sx={{
            position: 'absolute',
            left: `${markerLeft}%`,
            top: `${markerTop}%`,
            width: 5,
            height: 5,
            ml: '-2.5px',
            mt: '-2.5px',
            borderRadius: '50%',
            bgcolor: colour,
          }}
        />
      )}
      </Box>
    </Tooltip>
  );
}
