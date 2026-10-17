import { useState } from 'react';
import { Box, Button, Collapse, Grid, Skeleton, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import { Link as RouterLink } from 'react-router-dom';
import { useMarketOverview } from '../api/hooks';
import { StatTile } from './ui/StatTile';
import { SectionCard } from './ui/SectionCard';
import { ChangePill } from './ui/ChangePill';
import { LiveNumber } from './ui/LiveNumber';
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

function MoverRow({ mover }: { mover: Mover }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography
          component={RouterLink}
          to={`/stocks/${mover.symbol}`}
          variant="body2"
          noWrap
          sx={{
            fontWeight: 600,
            color: 'text.primary',
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {mover.symbol}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {mover.companyName ?? DASH}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          <LiveNumber value={mover.currentPrice} format={formatNumber} flash />
        </Typography>
        <ChangePill value={mover.changePercent} flash />
      </Stack>
    </Stack>
  );
}

/**
 * One movers group: the first three rows, then the rest behind a disclosure.
 *
 * The extra rows are mounted only while expanded (`unmountOnExit`) and each one enters 30ms after
 * the one above it, so the group reads as unfolding rather than as five rows appearing at once.
 * Nothing animates on collapse beyond the height, and the stagger cannot replay while the list is
 * being polled: a poll replaces the data, not the mount.
 */
function MoverList({
  title,
  movers,
  expanded,
}: {
  title: string;
  movers: Mover[];
  expanded: boolean;
}) {
  const theme = useTheme();
  if (movers.length === 0) return null;
  const preview = movers.slice(0, PREVIEW);
  const rest = movers.slice(PREVIEW, FULL);
  return (
    <Box>
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
        {title}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 1 }}>
        {preview.map((m) => (
          <MoverRow key={m.symbol} mover={m} />
        ))}
        {rest.length > 0 && (
          <Collapse in={expanded} unmountOnExit timeout={250}>
            <Stack
              spacing={0.5}
              sx={{
                '@keyframes mover-in': {
                  from: { opacity: 0, transform: 'translateY(6px)' },
                  to: { opacity: 1, transform: 'none' },
                },
              }}
            >
              {rest.map((m, i) => (
                <Box
                  key={m.symbol}
                  sx={{ animation: `mover-in 220ms ${theme.app.motion.easing} ${i * 30}ms both` }}
                >
                  <MoverRow mover={m} />
                </Box>
              ))}
            </Stack>
          </Collapse>
        )}
      </Stack>
    </Box>
  );
}

/**
 * The breadth bar: one thin strip, advancers → unchanged → decliners, sized by count.
 *
 * The six tiles give the exact figures; this gives the shape. It scales in from the left once on
 * mount, then the segments re-proportion on a change. Only `flex-grow` and the container's
 * `transform` animate — the strip is 6px tall, so the layout work of three flex children is not
 * measurable next to the wash it saves the reader from doing in their head.
 */
function BreadthBar({ up, flat, down }: { up: number; flat: number; down: number }) {
  const theme = useTheme();
  const total = up + flat + down;
  if (total === 0) return null;

  const segment = (count: number, color: string) => (
    <Box
      sx={{
        flexGrow: count,
        flexBasis: 0,
        minWidth: count > 0 ? 3 : 0,
        bgcolor: color,
        transition: `flex-grow ${theme.app.motion.slow} ${theme.app.motion.easing}`,
      }}
    />
  );

  return (
    <Box
      role="img"
      aria-label={`${up} advancers, ${flat} unchanged, ${down} decliners`}
      sx={{
        mt: 2,
        display: 'flex',
        gap: '2px',
        height: 6,
        borderRadius: `${theme.app.radii.pill}px`,
        overflow: 'hidden',
        transformOrigin: 'left',
        animation: `breadth-in 500ms ${theme.app.motion.easing} both`,
        '@keyframes breadth-in': {
          from: { transform: 'scaleX(0)', opacity: 0 },
          to: { transform: 'scaleX(1)', opacity: 1 },
        },
      }}
    >
      {segment(up, theme.palette.up.main)}
      {segment(flat, theme.palette.text.disabled)}
      {segment(down, theme.palette.down.main)}
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
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Grid container spacing={2} sx={{ flexGrow: 1, alignContent: 'stretch' }}>
                <Grid item xs={6} md={4}>
                  <StatTile
                    label="Advancers"
                    value={<LiveNumber value={breadth?.advancers} format={formatCount} countUp flash />}
                    tone="up"
                    fill
                    centered
                    footer={hint('Stocks that rose this session')}
                  />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile
                    label="Decliners"
                    value={<LiveNumber value={breadth?.decliners} format={formatCount} countUp flash />}
                    tone="down"
                    fill
                    centered
                    footer={hint('Stocks that fell this session')}
                  />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile
                    label="Unchanged"
                    value={<LiveNumber value={breadth?.unchanged} format={formatCount} countUp flash />}
                    tone="muted"
                    fill
                    centered
                    footer={hint('Stocks that were flat this session')}
                  />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile
                    label="Volume"
                    value={
                      <LiveNumber
                        value={breadth?.totalVolume}
                        format={(n) => formatVolume(n) ?? DASH}
                        countUp
                        flash
                      />
                    }
                    fill
                    centered
                    footer={hint('Total shares traded this session')}
                  />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile
                    label="New highs"
                    value={<LiveNumber value={breadth?.newHighs} format={formatCount} countUp flash />}
                    fill
                    centered
                    footer={hint('At or above a 52-week high')}
                  />
                </Grid>
                <Grid item xs={6} md={4}>
                  <StatTile
                    label="New lows"
                    value={<LiveNumber value={breadth?.newLows} format={formatCount} countUp flash />}
                    fill
                    centered
                    footer={hint('At or below a 52-week low')}
                  />
                </Grid>
              </Grid>
              {breadth && (
                <BreadthBar up={breadth.advancers} flat={breadth.unchanged} down={breadth.decliners} />
              )}
            </Box>
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
                <MoverList title="Gainers" movers={movers.gainers} expanded={expanded} />
                <MoverList title="Losers" movers={movers.losers} expanded={expanded} />
                <MoverList title="Most active" movers={movers.mostActive} expanded={expanded} />
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
