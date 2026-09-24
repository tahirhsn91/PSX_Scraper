import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, Chip, Divider, Grid, LinearProgress, Skeleton, Stack,
  ToggleButton, ToggleButtonGroup, Typography, alpha,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import type { IndexSummary } from '../types';
import { MiniIndexChart } from './MiniIndexChart';

/**
 * The PSX index board on the dashboard: breadth first, then one tile per index.
 *
 * The board answers two questions in the order a reader asks them — "what is the market doing"
 * (the breadth strip) and "where is the KSE-100" (the headline tile) — before listing the rest.
 * Ordering is a control rather than a fixed choice: by size (the default: the biggest index is
 * usually the one being looked for), by size of move, or A–Z.
 *
 * Levels, points and percents are the exchange's own figures, unmodified. A missing reading
 * renders as a dash, never a zero, so an index the page did not quote reads as *unknown* rather
 * than flat — and the sorts and the breadth strip keep unknown out of both, so an unreported
 * index cannot be counted as a gain or drag the "biggest movers" list to the top.
 *
 * Only fields the API populates are shown: `open`/`high`/`low`/`volume` are null for every index
 * today, so there is no day-range bar and no volume column here — a placeholder for data we do
 * not have would read as data we do.
 */

type SortMode = 'size' | 'move' | 'symbol';
type Direction = 'up' | 'down' | 'flat' | 'unknown';

const GLYPH: Record<Direction, string> = { up: '▲', down: '▼', flat: '·', unknown: '' };

/** Levels run to seven figures with paisa: thousands separators, two decimals. */
const formatLevel = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** The exchange's own change sign decides the direction, never the level's magnitude. */
function directionOf(change: number | null): Direction {
  if (change === null) return 'unknown';
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}

/**
 * Direction → ink colour, and a 12% tint of the same token for the magnitude bar.
 *
 * Both come from the palette so light and dark stay legible; the arrow glyph is what carries the
 * direction for anyone who cannot separate the two hues.
 */
function toneOf(direction: Direction): { ink: string; bar: string | ((t: Theme) => string) } {
  if (direction === 'up') {
    return { ink: 'success.main', bar: (t: Theme) => alpha(t.palette.success.main, 0.85) };
  }
  if (direction === 'down') {
    return { ink: 'error.main', bar: (t: Theme) => alpha(t.palette.error.main, 0.85) };
  }
  return { ink: 'text.secondary', bar: (t: Theme) => alpha(t.palette.text.secondary, 0.35) };
}

/** How many indices the board shows before the reader asks for the rest. */
const TOP = 3;

/** One tile. Kept as a component so the featured tile and the rest cannot drift apart. */
function IndexTile({ index, featured = false }: { index: IndexSummary; featured?: boolean }) {
  const direction = directionOf(index.changePercent ?? index.change);
  const tone = toneOf(direction);

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        // Column flex so the tile's foot can be pinned to the card's bottom: cards in a row stretch
        // to the tallest one, and without this the change figure drifts up into the middle of the
        // taller cards instead of sitting in the same corner as everywhere else.
        display: 'flex',
        flexDirection: 'column',
        ...(featured ? { borderColor: 'primary.main', borderWidth: 2 } : {}),
      }}
    >
      {/* A real link, not a clickable box: the board is a list of destinations, and this way it
          works with the keyboard, with a middle-click, and with "open in new tab". */}
      <CardActionArea
        component={RouterLink}
        to={`/indices/${index.symbol}`}
        sx={{ height: '100%', p: 1.25, alignItems: 'stretch', display: 'flex', flexDirection: 'column' }}
      >
        {featured && (
          <Chip
            size="small"
            color="primary"
            label="HEADLINE"
            sx={{ position: 'absolute', top: 0, right: 0, borderRadius: '0 0 0 8px', fontSize: 10, height: 20 }}
          />
        )}
        {/* The badge sits in the top-right corner, so the featured tile's header row keeps clear
            of it — otherwise it covers the change figure, which is the one thing the tile is for. */}
        <Stack
          direction="row"
          alignItems="flex-start"
          justifyContent="space-between"
          // `useFlexGap` so the gap comes from CSS `gap`: with the margin-based spacing the Stack
          // also emits `> :not(style) + :not(style) { margin: 0 }`, which silently ate the headline
          // chart's offset below and left it pinned to the top of its card.
          useFlexGap
          spacing={1}
          sx={{ pr: featured ? 9 : 0 }}
        >
          <Typography variant="subtitle1" fontWeight={700} noWrap>
            {index.symbol}
          </Typography>
          {/* Every card carries its own chart beside the symbol — except the headline card, whose
              chart runs along the foot of the card instead (below), because a wide, tall card has
              the room for it and the corner would leave it stranded. */}
          {!featured && (
            <Box sx={{ flexShrink: 0 }}>
              <MiniIndexChart symbol={index.symbol} flat={direction === 'flat'} />
            </Box>
          )}
        </Stack>

        <Typography
          variant={featured ? 'h4' : 'h5'}
          sx={{ mt: 0.25, fontVariantNumeric: 'tabular-nums', letterSpacing: featured ? '-.5px' : undefined }}
        >
          {index.value === null ? '—' : formatLevel(index.value)}
        </Typography>

        {/* The tile's foot, pushed to the bottom of the card: on a row where a card is stretched by
            a taller neighbour, the volume and the change figure still land on the same line as
            their neighbours rather than floating in the middle of the card. */}
        <Stack
          direction="row"
          alignItems="baseline"
          justifyContent="space-between"
          spacing={1}
          sx={{ mt: 'auto', pt: 0.5 }}
        >
          {/* The index summary carries no volume yet — the exchange's index pages publish none, and
              the scraper writes null — so this reads as a dash rather than as a zero traded. */}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
          >
            {index.volume === null ? 'Vol: —' : `Vol: ${index.volume.toLocaleString()}`}
          </Typography>
          <Typography
            variant="subtitle2"
            fontWeight={700}
            sx={{ color: tone.ink, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
          >
            {index.changePercent === null ? '—' : `${GLYPH[direction]} ${Math.abs(index.changePercent).toFixed(2)}%`}
          </Typography>
        </Stack>

        {/* The headline card's chart: along the foot of the card, just above its lower border, so
            the widest card on the board closes on the index's own shape rather than on empty space. */}
        {featured && (
          <Box sx={{ mt: 1.5 }}>
            <MiniIndexChart symbol={index.symbol} fullWidth flat={direction === 'flat'} />
          </Box>
        )}
      </CardActionArea>
    </Card>
  );
}

/** The breadth strip: how many indices are up, down, unchanged — and how many are unheard from. */
function Breadth({ counts }: { counts: { up: number; down: number; flat: number; unknown: number } }) {
  const cell = (glyph: string, label: string, value: number, color?: string) => (
    <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ color }}>
      <Typography variant="body2" component="span" aria-hidden>
        {glyph}
      </Typography>
      <Typography variant="caption" color={color ? undefined : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
  );

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={2}
      useFlexGap
      flexWrap="wrap"
      role="status"
      aria-label="Market breadth across the tracked indices"
    >
      {cell('▲', 'advancers', counts.up, 'success.main')}
      {cell('▼', 'decliners', counts.down, 'error.main')}
      {cell('·', 'unchanged', counts.flat)}
      {/* Only when it happens: an unwritten index is neither a gain nor a loss, and saying so
          beats folding it into "unchanged". */}
      {counts.unknown > 0 && cell('—', 'not quoted', counts.unknown)}
    </Stack>
  );
}

export function IndicesPanel({
  indices,
  isLoading = false,
  isError = false,
}: {
  indices: IndexSummary[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const [sort, setSort] = useState<SortMode>('size');
  const [showAll, setShowAll] = useState(false);

  const counts = useMemo(() => {
    const list = indices ?? [];
    return {
      up: list.filter((i) => i.changePercent !== null && i.changePercent > 0).length,
      down: list.filter((i) => i.changePercent !== null && i.changePercent < 0).length,
      flat: list.filter((i) => i.changePercent === 0).length,
      unknown: list.filter((i) => i.changePercent === null).length,
    };
  }, [indices]);

  const ordered = useMemo(() => {
    const list = [...(indices ?? [])];
    // Unknowns sort last in every mode: a missing reading is not the smallest value.
    const lastIfUnknown = (a: number | null, b: number | null, fallback: () => number) => {
      if (a === null && b === null) return fallback();
      if (a === null) return 1;
      if (b === null) return -1;
      return 0;
    };
    list.sort((a, b) => {
      if (sort === 'move') {
        return lastIfUnknown(a.changePercent, b.changePercent, () => a.symbol.localeCompare(b.symbol))
          || Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0)
          || a.symbol.localeCompare(b.symbol);
      }
      if (sort === 'symbol') return a.symbol.localeCompare(b.symbol);
      return lastIfUnknown(a.value, b.value, () => a.symbol.localeCompare(b.symbol))
        || (b.value ?? 0) - (a.value ?? 0)
        || a.symbol.localeCompare(b.symbol);
    });
    return list;
  }, [indices, sort]);

  const asOf = useMemo(() => {
    const newest = (indices ?? []).reduce<string | null>(
      (latest, i) => (i.lastTradeDate && (!latest || i.lastTradeDate > latest) ? i.lastTradeDate : latest),
      null,
    );
    return newest ? new Date(newest).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  }, [indices]);

  // Loading, failure and "nothing published" are three different pages, and each says which one
  // it is. The panel is a content block, so an absent board is worth stating rather than hiding:
  // a silent gap is indistinguishable from a board that has not loaded yet.
  const featured = ordered.find((i) => i.symbol === 'KSE100') ?? ordered[0];
  const rest = ordered.filter((i) => i !== featured);
  // The board opens as a summary — the featured index plus the next two, in whatever order the
  // reader picked — and the rest stay behind an explicit "see all" rather than behind a scroll.
  const visible = showAll ? rest : rest.slice(0, TOP - 1);

  return (
    <Box sx={{ mb: 3 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1.5}
        useFlexGap
        flexWrap="wrap"
        sx={{ mb: 1 }}
      >
        <Stack direction="row" alignItems="baseline" spacing={1} useFlexGap flexWrap="wrap">
          <Typography variant="subtitle2" color="text.secondary">
            PSX indices {indices?.length ? `(${indices.length})` : ''}
          </Typography>
          {asOf && (
            <Typography variant="caption" color="text.secondary">
              as of {asOf}
            </Typography>
          )}
        </Stack>

        {/* Ordering is a control, not an opinion baked into the layout. */}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={sort}
          onChange={(_, next: SortMode | null) => next && setSort(next)}
          aria-label="Order the index board"
        >
          <ToggleButton value="size" aria-label="Order by size">
            By size
          </ToggleButton>
          <ToggleButton value="move" aria-label="Order by size of move">
            By move
          </ToggleButton>
          <ToggleButton value="symbol" aria-label="Order alphabetically">
            A–Z
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {isError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Couldn’t load the index board. The exchange’s market summary did not answer.
        </Alert>
      )}

      {isLoading && !indices?.length && (
        <Box>
          <LinearProgress sx={{ mb: 1.5 }} />
          <Grid container spacing={1}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Grid item xs={12} sm={6} md={3} key={i}>
                <Skeleton variant="rounded" height={116} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {!isLoading && !isError && (!indices || indices.length === 0) && (
        <Alert severity="info">
          No index data yet — the exchange’s market summary hasn’t been fetched.
        </Alert>
      )}

      {featured && (
        <>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1.5}
            useFlexGap
            flexWrap="wrap"
            sx={{ mb: 1 }}
          >
            <Breadth counts={counts} />
          </Stack>

          <Grid container spacing={1}>
            {/* The headline tile is exactly two tiles wide (6 of 12 columns at md and up, 12 of
                12 at sm, where the tiles go two-up): a width that is a whole number of tile
                widths. Anything else — the 4 columns this started as — leaves the row short and
                knocks the first tiles out of the column grid the rows below them use, so no tile
                lines up with the one under it. */}
            <Grid item xs={12} sm={12} md={6} lg={6}>
              <IndexTile index={featured} featured />
            </Grid>
            {visible.map((index) => (
              <Grid item xs={12} sm={6} md={3} key={index.symbol}>
                <IndexTile index={index} />
              </Grid>
            ))}
          </Grid>

          {/* A disclosure, not a second page: the tiles behind this button are the same list the
              reader is already scanning, so they open in place instead of becoming a page number. */}
          {rest.length > TOP - 1 && (
            <Stack direction="row" justifyContent="center" sx={{ mt: 1.5 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setShowAll((shown) => !shown)}
                aria-expanded={showAll}
              >
                {showAll ? `Show top ${TOP} only` : `See all ${ordered.length} indices`}
              </Button>
            </Stack>
          )}

          <Divider sx={{ mt: 1.5, mb: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            {featured.symbol === 'KSE100' ? 'KSE-100 shown first · ' : ''}
            {showAll ? `all ${ordered.length} indices` : `the top ${TOP} indices`} · tap one to open its chart.
          </Typography>
        </>
      )}
    </Box>
  );
}
