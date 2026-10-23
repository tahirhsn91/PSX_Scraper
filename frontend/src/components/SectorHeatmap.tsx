import { Box, Typography, alpha, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { GLYPH, formatCount, formatMarketCap, trendOf } from '../lib/format';
import type { SectorSummary } from '../types';

/**
 * The sector heat grid.
 *
 * A table answers "what did this sector do, exactly"; it does not answer "where is the market
 * moving" without reading thirty rows. This does: one tile per sector, tinted by the sector's
 * average move — green up, red down, grey unread — with the figure itself always printed on the
 * tile. Colour is never the only signal.
 *
 * The tint's strength is normalised against the day's own largest move (capped at 3%), not a fixed
 * scale: on a quiet day every tile would be almost white against a fixed ±5% ramp, and on a violent
 * day every tile would saturate. The grid reads the day it is showing.
 *
 * Tiles enter 25ms apart, capped at 16 tiles so a long list does not spend a second animating. The
 * animation fills `backwards` only — a completed animation with `forwards` would pin `transform` and
 * kill the hover lift.
 */

/** Tiles that get their own entrance delay; the rest enter with the 16th. */
const MAX_STAGGERED = 16;
const STAGGER_MS = 25;

export function SectorHeatmap({ sectors }: { sectors: SectorSummary[] }) {
  const theme = useTheme();
  if (sectors.length === 0) return null;

  const largest = sectors.reduce((max, s) => Math.max(max, Math.abs(s.avgChangePercent ?? 0)), 0);
  // A 3% day is already a strong day on the PSX; beyond that the tint stops getting darker.
  const scale = Math.max(1, Math.min(largest, 3));
  // The endpoint orders alphabetically; heat is read by weight, so the biggest sector is the first
  // tile. The table below keeps the alphabetical order, where a reader is looking names up.
  const ordered = [...sectors].sort((a, b) => (b.totalMarketCap ?? 0) - (a.totalMarketCap ?? 0));

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          sm: 'repeat(3, minmax(0, 1fr))',
          md: 'repeat(4, minmax(0, 1fr))',
          lg: 'repeat(5, minmax(0, 1fr))',
        },
        gap: 1,
      }}
    >
      {ordered.map((sector, index) => {
        const percent = sector.avgChangePercent;
        const trend = trendOf(percent);
        const direction = trend === 'up' ? theme.palette.up : trend === 'down' ? theme.palette.down : null;
        const strength = percent == null ? 0 : Math.min(1, Math.abs(percent) / scale);
        const background = direction
          ? alpha(direction.main, 0.12 + strength * 0.45)
          : theme.palette.action.hover;
        const ink = direction ? direction.onSoft : theme.palette.text.secondary;

        return (
          <Box
            key={sector.sector}
            component={RouterLink}
            to={`/sectors/detail?sector=${encodeURIComponent(sector.sector)}`}
            aria-label={`${sector.sector}: ${
              percent == null
                ? 'no reading'
                : `${percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat'} ${Math.abs(percent).toFixed(2)} percent average`
            }, ${sector.count} stocks`}
            title={sector.sector}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              minHeight: 106,
              p: 1.5,
              borderRadius: 2,
              bgcolor: background,
              border: '1px solid',
              borderColor: direction ? alpha(direction.main, 0.35) : 'divider',
              color: ink,
              textDecoration: 'none',
              transition: `transform ${theme.app.motion.fast} ${theme.app.motion.easing}, box-shadow ${theme.app.motion.fast} ${theme.app.motion.easing}`,
              animation: `sector-in 260ms ${theme.app.motion.easing} ${
                Math.min(index, MAX_STAGGERED) * STAGGER_MS
              }ms backwards`,
              '@keyframes sector-in': {
                from: { opacity: 0, transform: 'translateY(8px)' },
                to: { opacity: 1, transform: 'none' },
              },
              '&:hover': { transform: 'translateY(-2px)', boxShadow: theme.shadows[2] },
              '&:focus-visible': {
                outline: `2px solid ${theme.palette.focusRing}`,
                outlineOffset: 2,
              },
              // The lift is motion; the tint and the figure still say everything without it.
              '@media (prefers-reduced-motion: reduce)': {
                animation: 'none',
                transition: 'none',
                '&:hover': { transform: 'none' },
              },
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                // Two lines on a phone, where a 2-column grid would otherwise clip every long
                // name to "COMMERCIAL BAN…". The min-height keeps one-line and two-line tiles
                // sharing a baseline in the same row.
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                // "PHARMACEUTICALS" is one word: without a break opportunity it ran past the tile
                // edge instead of using the second line.
                overflowWrap: 'anywhere',
                minHeight: '2.6em',
              }}
            >
              {sector.sector}
            </Typography>
            <Typography
              variant="h6"
              sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, lineHeight: 1.15 }}
            >
              {percent == null ? '—' : `${GLYPH[trend ?? 'flat']} ${Math.abs(percent).toFixed(2)}%`}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85, mt: 'auto' }}>
              {formatCount(sector.count)} stocks · {formatMarketCap(sector.totalMarketCap) ?? '—'}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
