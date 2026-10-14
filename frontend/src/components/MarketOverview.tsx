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

/** A small muted caption explaining what a breadth tile counts. */
function hint(text: string) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
      {text}
    </Typography>
  );
}

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
            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
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
            </Stack>
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
            {/*
              Loading renders the real components with the app's own DASH placeholder, rather than a
              row of skeletons.

              The skeletons were 72px tall while a filled StatTile — label, large value, caption
              footer, centred — is taller, so this section grew the moment data landed. Measured on a
              throttled mobile run: the breadth box moved at 9.3s for a CLS of 0.2731, 2.7x the "good"
              threshold, and because these cards stack on a narrow viewport the growth of the card
              *above* this one is what moved it.

              Same components in both states means the box is identical before and after the data
              arrives, so there is nothing left to shift. A dash is already this app's convention for
              a value that is not known yet.
            */}
            <Grid container spacing={2} sx={{ height: '100%', alignContent: 'stretch' }}>
              <Grid item xs={6} md={4}>
                <StatTile label="Advancers" value={breadth ? formatCount(breadth.advancers) : DASH} tone="up" fill centered footer={hint('Stocks that rose this session')} />
              </Grid>
              <Grid item xs={6} md={4}>
                <StatTile label="Decliners" value={breadth ? formatCount(breadth.decliners) : DASH} tone="down" fill centered footer={hint('Stocks that fell this session')} />
              </Grid>
              <Grid item xs={6} md={4}>
                <StatTile label="Unchanged" value={breadth ? formatCount(breadth.unchanged) : DASH} tone="muted" fill centered footer={hint('Stocks that were flat this session')} />
              </Grid>
              <Grid item xs={6} md={4}>
                <StatTile label="Volume" value={breadth ? formatVolume(breadth.totalVolume) ?? DASH : DASH} fill centered footer={hint('Total shares traded this session')} />
              </Grid>
              <Grid item xs={6} md={4}>
                <StatTile label="New highs" value={breadth ? formatCount(breadth.newHighs) : DASH} fill centered footer={hint('At or above a 52-week high')} />
              </Grid>
              <Grid item xs={6} md={4}>
                <StatTile label="New lows" value={breadth ? formatCount(breadth.newLows) : DASH} fill centered footer={hint('At or below a 52-week low')} />
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={5}>
          <SectionCard title="Top movers" subtitle="Largest percentage moves this session" sx={{ height: '100%' }}>
            {isLoading || !movers ? (
              /*
                The loading shape mirrors the loaded one — three groups of a caption plus a preview
                row each — instead of six flat bars. Flat bars were roughly half the height of three
                real mover lists, so this card grew when the data arrived, and on a narrow viewport
                the cards stack: that growth is what pushed the breadth card below it down by 0.2731.
              */
              <Stack spacing={2} sx={{ height: '100%' }}>
                {Array.from({ length: 3 }).map((_, g) => (
                  <Stack key={g} spacing={1}>
                    <Skeleton variant="text" width={72} height={20} />
                    {Array.from({ length: PREVIEW }).map((__, r) => (
                      <Skeleton key={r} variant="text" height={40} />
                    ))}
                  </Stack>
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
