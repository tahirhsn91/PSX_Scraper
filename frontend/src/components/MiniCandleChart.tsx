import { useMemo } from 'react';
import { Box, Skeleton, Tooltip, Typography, useTheme } from '@mui/material';
import { useIndexHistory } from '../api/hooks';
import { toCandles, toneOf, type MiniCandle } from '../lib/candles';

/**
 * A card-sized candlestick chart for one index: its own recent sessions, ending in today's.
 *
 * Its own SVG rather than the charting library: seventeen of these draw at once inside a 44px
 * strip, where a canvas per card is all overhead and no detail. Each candle is that index's real
 * session — open to close, coloured by the session's own direction — so every card draws its own
 * shape. Two cards looking alike means two series that moved alike, not one drawing repeated.
 *
 * What the data does not have, the chart does not invent. The exchange publishes no high or low for
 * indices at all (the API returns null for both), so there are no wicks. The open is missing for
 * most sessions, so a session without one is drawn from the previous session's close to its own
 * close — the day's real net move — rather than from a made-up open.
 */

/** Chart height in CSS pixels, fixed so cards on a row stay the same height. */
const HEIGHT = 44;

/** viewBox units. The SVG stretches to the card, so these are proportions, not pixels. */
const W = 100;
const H = HEIGHT;

const level = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * Hover detail. Kept to four short lines on purpose: a card in a dense grid must not have its
 * neighbours covered to explain itself. High/low are named as unpublished rather than shown as
 * dashes, because a dash next to a value reads as "zero today" and this is "never published".
 */
function CandleDetail({ symbol, candles }: { symbol: string; candles: MiniCandle[] }) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const pct = prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : null;
  return (
    <Box sx={{ py: 0.25 }}>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
        {symbol} · {day(last.date)}
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

export function MiniCandleChart({
  symbol,
  sessions = 28,
  flat = false,
}: {
  symbol: string;
  /**
   * How many sessions to draw. A shorter window means each candle's body carries more of the
   * card's 44px: daily index moves are a few tenths of a percent against a window range of a few
   * percent, so forty sessions draws a ribbon where twenty-eight draws candles. Still every session
   * we hold, just fewer of them on screen.
   */
  sessions?: number;
  /** Today's move is not meaningful — the whole chart goes neutral rather than forcing a tone. */
  flat?: boolean;
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

  if (isLoading && candles.length === 0) {
    return <Skeleton variant="rounded" height={HEIGHT} sx={{ mt: 1 }} />;
  }

  // No series, no chart: a baseline keeps the card's height and claims nothing. Drawing a shape
  // here would be the one thing this component must never do.
  if (candles.length < 2) {
    return (
      <Box
        sx={{
          mt: 1,
          height: HEIGHT,
          display: 'grid',
          placeItems: 'center',
          borderBottom: '1px dashed',
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.disabled">
          no sessions yet
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
  const y = (value: number) => H - ((value - lo) / (hi - lo)) * H;

  const slot = W / candles.length;
  const bodyWidth = Math.max(0.7, Math.min(slot * 0.62, 3.2));
  const last = candles[candles.length - 1];

  return (
    <Tooltip arrow placement="top" title={<CandleDetail symbol={symbol} candles={candles} />}>
      <Box sx={{ mt: 1, height: HEIGHT, cursor: 'inherit' }}>
        <Box
          component="svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${symbol}: ${candles.length} sessions of daily candles, latest session ${
            flat ? 'unchanged' : last.close >= last.open ? 'up' : 'down'
          }`}
          sx={{ display: 'block', width: '100%', height: HEIGHT, overflow: 'visible' }}
        >
          {candles.map((candle, i) => {
            const top = Math.min(y(candle.open), y(candle.close));
            const height = Math.max(0.6, Math.abs(y(candle.close) - y(candle.open)));
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

          {/* Current price: one hairline across the chart plus a marker at the last close. The
              marker is what makes the tail of the series readable as "now" rather than an end. */}
          <line
            x1={0}
            x2={W}
            y1={y(last.close)}
            y2={y(last.close)}
            stroke={theme.palette.text.secondary}
            strokeOpacity={0.32}
            strokeWidth={1}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          <rect
            x={W - 1.6}
            y={y(last.close) - 1.6}
            width={3.2}
            height={3.2}
            fill={ink(toneOf(last, flat))}
          />
        </Box>
      </Box>
    </Tooltip>
  );
}
