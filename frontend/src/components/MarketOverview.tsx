import { Box, Grid, Skeleton, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useMarketOverview } from '../api/hooks';
import { StatTile } from './ui/StatTile';
import { SectionCard } from './ui/SectionCard';
import { ChangePill } from './ui/ChangePill';
import { formatCount, formatNumber, formatVolume, DASH } from '../lib/format';
import type { Mover } from '../types';

function MoverList({ title, movers }: { title: string; movers: Mover[] }) {
  if (movers.length === 0) return null;
  return (
    <Box>
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
        {title}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 1 }}>
        {movers.slice(0, 8).map((m) => (
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
 */
export function MarketOverview() {
  const { data, isLoading } = useMarketOverview();
  if (!data && !isLoading) return null;
  const breadth = data?.breadth;

  return (
    <Box sx={{ mb: 3 }}>
      <Grid container spacing={2}>
        <Grid item xs={12} md={7}>
          <SectionCard
            title="Market breadth"
            subtitle="Advancers and decliners across every tracked symbol this session"
          >
            {isLoading || !breadth ? (
              <Grid container spacing={2}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Grid item xs={6} md={4} key={i}>
                    <Skeleton variant="rounded" height={72} />
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Grid container spacing={2}>
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
          <SectionCard title="Top movers" subtitle="Largest percentage moves this session">
            {isLoading || !data ? (
              <Stack spacing={1.5}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} variant="text" height={32} />
                ))}
              </Stack>
            ) : (
              <Stack spacing={2}>
                <MoverList title="Gainers" movers={data.movers.gainers} />
                <MoverList title="Losers" movers={data.movers.losers} />
                <MoverList title="Most active" movers={data.movers.mostActive} />
              </Stack>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
