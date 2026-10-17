import { useEffect, useState } from 'react';
import { Box, Stack, Typography, alpha, useTheme } from '@mui/material';
import { formatRupees } from '../lib/format';
import type { HoldingRow } from '../lib/portfolio';

/**
 * The portfolio's composition, as a donut.
 *
 * The table below answers "what do I own and what is it worth"; this answers "where is the book
 * concentrated" before any row is read. Slices are worth-ordered, the seven smallest positions
 * collapse into one `Other` slice so a long tail cannot turn the ring into confetti, and the centre
 * reports the priced book's value — or the hovered slice, so the ring explains itself without a
 * tooltip.
 *
 * Portfolios here are small (a handful of positions), so the ring is drawn as plain SVG: no chart
 * library, no canvas, and the slice geometry is a percentage of the circumference.
 *
 * The draw-in grows each arc along its own path (`stroke-dasharray`), one after another. It is a
 * transition rather than an animation so a price refresh — which changes the percentages — slides
 * the arcs to their new sizes instead of replaying the entrance.
 */

const SIZE = 168;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Positions shown individually; the rest become one `Other` slice. */
const MAX_SLICES = 6;
/** Gap between slices, in path pixels. */
const GAP = 2;
const DRAW_MS = 700;
const STAGGER_MS = 80;

interface Slice {
  key: string;
  label: string;
  value: number;
  percent: number;
  color: string;
}

export function PortfolioComposition({ rows, total }: { rows: HoldingRow[]; total: number }) {
  const theme = useTheme();
  const [drawn, setDrawn] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    // One frame after mount, so the initial `0` dash is painted and the transition has a start.
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const priced = rows
    .filter((row): row is HoldingRow & { value: number } => row.value != null && row.value > 0)
    .sort((a, b) => b.value - a.value);

  // One slice is not a composition, and a total of zero has no percentages to show.
  if (priced.length < 2 || total <= 0) return null;

  /**
   * Categorical colours from the app's own series palette — the SMA overlays already use these
   * together on the stock charts, and they are contrast-checked in both modes. Deliberately not
   * `up`/`down`: on this page those mean direction, and a holding is not a direction.
   */
  const palette = [
    theme.palette.chart.sma20,
    theme.palette.chart.gold,
    theme.palette.chart.sma50,
    theme.palette.chart.sma200,
    theme.palette.primary.main,
    theme.palette.text.disabled,
  ];

  const top = priced.slice(0, MAX_SLICES);
  const rest = priced.slice(MAX_SLICES);
  const restValue = rest.reduce((sum, row) => sum + row.value, 0);

  const slices: Slice[] = top.map((row, index) => ({
    key: row.symbol,
    label: row.symbol,
    value: row.value,
    percent: (row.value / total) * 100,
    color: palette[index % palette.length],
  }));
  if (restValue > 0) {
    slices.push({
      key: '__other',
      label: `${rest.length} more`,
      value: restValue,
      percent: (restValue / total) * 100,
      color: alpha(theme.palette.text.disabled, 0.6),
    });
  }

  let cursor = 0;
  const arcs = slices.map((slice) => {
    const length = (slice.percent / 100) * CIRCUMFERENCE;
    const arc = { ...slice, start: cursor, length: Math.max(0, length - GAP) };
    cursor += length;
    return arc;
  });

  const activeSlice = slices.find((slice) => slice.key === active) ?? null;
  const share = (percent: number) => `${percent.toFixed(1)}%`;

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 2, sm: 3 }}
      alignItems={{ sm: 'center' }}
      sx={{ justifyContent: { sm: 'center' } }}
    >
      <Box sx={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0, mx: { xs: 'auto', sm: 0 } }}>
        <Box
          component="svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Portfolio composition: ${slices
            .map((slice) => `${slice.label} ${share(slice.percent)}`)
            .join(', ')}`}
          sx={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}
        >
          {/* The track, so a missing or tiny book still reads as a ring rather than a stray arc. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={theme.palette.divider}
            strokeWidth={STROKE}
            strokeOpacity={0.5}
          />
          {arcs.map((arc, index) => (
            <circle
              key={arc.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={arc.color}
              strokeWidth={STROKE}
              // Each circle starts at 3 o'clock; -90 puts the first slice's start at 12 o'clock.
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              strokeDasharray={drawn ? `${arc.length} ${CIRCUMFERENCE}` : `0 ${CIRCUMFERENCE}`}
              strokeDashoffset={-arc.start}
              onMouseEnter={() => setActive(arc.key)}
              onMouseLeave={() => setActive(null)}
              style={{
                transition: `stroke-dasharray ${DRAW_MS}ms ${theme.app.motion.easing} ${
                  index * STAGGER_MS
                }ms, opacity ${theme.app.motion.fast} ${theme.app.motion.easing}`,
                opacity: active != null && active !== arc.key ? 0.35 : 1,
                cursor: 'default',
              }}
            />
          ))}
        </Box>

        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            alignContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
            px: 3,
          }}
        >
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2 }}>
            {activeSlice ? activeSlice.label : 'Priced book'}
          </Typography>
          <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>
            {activeSlice ? share(activeSlice.percent) : formatRupees(total)}
          </Typography>
          {activeSlice && (
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
              {formatRupees(activeSlice.value)}
            </Typography>
          )}
        </Box>
      </Box>

      <Box
        component="ul"
        aria-label="Portfolio composition"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          width: '100%',
          minWidth: 0,
          // One column, not two: with short symbols a two-column grid leaves a canyon between the
          // columns and reads as two unrelated lists. Six rows match the ring's own height.
          maxWidth: { sm: 320 },
          display: 'grid',
          gridTemplateColumns: '1fr',
          columnGap: 2,
          rowGap: 0.5,
        }}
      >
        {slices.map((slice) => (
          <Stack
            component="li"
            key={slice.key}
            direction="row"
            spacing={1}
            alignItems="center"
            onMouseEnter={() => setActive(slice.key)}
            onMouseLeave={() => setActive(null)}
            sx={{
              minWidth: 0,
              opacity: active != null && active !== slice.key ? 0.5 : 1,
              transition: `opacity ${theme.app.motion.fast} ${theme.app.motion.easing}`,
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 10,
                height: 10,
                flexShrink: 0,
                borderRadius: '3px',
                bgcolor: slice.color,
              }}
            />
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {slice.label}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
            >
              {share(slice.percent)}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Stack>
  );
}
