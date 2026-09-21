import { Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { IndexSummary } from '../types';

/**
 * The index ribbon: a continuously sliding strip of every index PSX publishes.
 *
 * Two copies of the list are rendered and the strip translates by half its width, so the loop
 * is seamless — there is no jump back to the start. It pauses on hover, and under
 * `prefers-reduced-motion` it stops sliding and becomes a scrollable strip instead, because a
 * moving ticker is exactly what that setting is asking us not to do.
 *
 * Each entry is a link to that index's page.
 */
export function IndicesTicker({ indices }: { indices: IndexSummary[] | undefined }) {
  const navigate = useNavigate();
  if (!indices || indices.length === 0) return null;

  const entries = [...indices, ...indices];

  return (
    <Box
      sx={{
        overflow: 'hidden',
        borderTop: 1,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
        py: 0.75,
        mb: 2,
        '@keyframes indicesTicker': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      }}
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          willChange: 'transform',
          animation: 'indicesTicker 90s linear infinite',
          '&:hover': { animationPlayState: 'paused' },
          '@media (prefers-reduced-motion: reduce)': {
            animation: 'none',
            display: 'flex',
            overflowX: 'auto',
          },
        }}
      >
        {entries.map((index, position) => {
          const change = index.change;
          const tone = change === null ? 'text.secondary' : change > 0 ? 'success.main' : change < 0 ? 'error.main' : 'text.secondary';
          return (
            <Box
              key={`${index.symbol}-${position}`}
              onClick={() => navigate(`/indices/${index.symbol}`)}
              sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75, px: 1.5, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              <Typography variant="caption" fontWeight={700}>{index.symbol}</Typography>
              <Typography variant="caption" color="text.secondary">
                {index.value === null ? '—' : index.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Typography>
              <Typography variant="caption" sx={{ color: tone }}>
                {change === null
                  ? '—'
                  : `${change > 0 ? '▲' : change < 0 ? '▼' : '·'} ${change.toFixed(2)}${index.changePercent === null ? '' : ` (${index.changePercent.toFixed(2)}%)`}`}
              </Typography>
              <Typography variant="caption" color="divider">|</Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
