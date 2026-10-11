import { useState } from 'react';
import { Box, Button, Grid, Skeleton, Stack, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import { Link as RouterLink } from 'react-router-dom';
import { useMarketOverview } from '../api/hooks';
import { StatTile } from './ui/StatTile';
import { SectionCard } from './ui/SectionCard';
import { ChangePill } from './ui/ChangePill';
import { formatCount, formatNumber, formatVolume, DASH } from '../lib/format';
import type { Mover } from '../types';

/** Movers shown per list before expanding. */
const PREVIEW = 3;
/** Upper bound when expanded (the endpoint itself returns 5). */
const FULL = 8;

function MoverList({ title, movers, limit }: { title: string; movers: Mover[]; limit: number }) {
  if (movers.length === 0) return null;
  return (
    <Box>
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
        {title}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 1 }}>
        {movers.slice(0, limit).map((m) => (
          <Stack key={m.symbol} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography
                component={RouterLink}
                to={`/stocks/${m.symbol}`}
                variant="body2"
                noWrap
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {m.symbol}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {m.companyName ?? DASH}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatNumber(m.currentPrice)}
              </Typography>
              <ChangePill value={m.changePercent} />
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

/**
 * The dashboard's market summary: breadth on the left, the session's biggest movers on the right.
 * Renders nothing when the endpoint has no data (an absent strip is honest, a broken-looking one is not).
 * Both cards stretch to the same height so the shorter one never leaves a gap after it.
 */
export function MarketOverview() {
  const { data, isLoading } = useMarketOverview();
  const [expanded, setExpanded] = useState(false);
  if (!data && !isLoading) return null;
  const breadth = data?.breadth;
  const movers = data?.movers;
  const limit = expanded ? FULL : PREVIEW;
  const hasMore =
    !expanded &&
    movers != null &&
    (movers.gainers.length > PREVIEW ||
      movers.losers.length > PREVIEW ||
      movers.mostActive.length > PREVIEW);

  return (
    <Box sx={{ mb: 3 }}>
      <Grid container spacing={2}>
        <Grid item xs={12} md={7}>
          <SectionCard
            title="Market breadth"
            subtitle="Advancers and decliners across every tracked symbol this session"
            sx={{ height: '100%' }}
          >
            {isLoading || !breadth ? (
              <Grid container spacing={2} sx={{ height: '100%', alignContent: 'center' }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Grid item xs={6} md={4} key={i}>
                    <Skeleton variant="rounded" height={72} />
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Grid container spacing={2} sx={{ height: '100%', alignContent: 'center' }}>
                <Grid item xs={6} md={4}>
                  <StatTile label="Advancers" value={formatCount(breadth.advancers)} tone="up" />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile label="Decliners" value={formatCount(breadth.decliners)} tone="down" />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile label="Unchanged" value={formatCount(breadth.unchanged)} tone="muted" />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile label="Volume" value={formatVolume(breadth.totalVolume) ?? DASH} />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile label="New highs" value={formatCount(breadth.newHighs)} />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile label="New lows" value={formatCount(breadth.newLows)} />
                </Grid>
              </Grid>
            )}
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={5}>
          <SectionCard title="Top movers" subtitle="Largest percentage moves this session" sx={{ height: '100%' }}>
            {isLoading || !movers ? (
              <Stack spacing={1.5}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} variant="text" height={32} />
                ))}
              </Stack>
            ) : (
              <Stack spacing={2} sx={{ height: '100%' }}>
                <MoverList title="Gainers" movers={movers.gainers} limit={limit} />
                <MoverList title="Losers" movers={movers.losers} limit={limit} />
                <MoverList title="Most active" movers={movers.mostActive} limit={limit} />
                {hasMore && (
                  <Button
                    size="small"
                    fullWidth
                    endIcon={<ExpandMoreRoundedIcon />}
                    onClick={() => setExpanded(true)}
                    aria-expanded={false}
                    sx={{ mt: 'auto' }}
                  >
                    Show more movers
                  </Button>
                )}
                {expanded && (
                  <Button
                    size="small"
                    fullWidth
                    endIcon={<ExpandLessRoundedIcon />}
                    onClick={() => setExpanded(false)}
                    aria-expanded={true}
                    sx={{ mt: 'auto' }}
                  >
                    Show less
                  </Button>
                )}
              </Stack>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
