import { useMemo, useState } from 'react';
import {
  Alert, Box, Card, CardActionArea, Chip, Divider, Grid, LinearProgress, Skeleton, Stack,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import type { IndexSummary } from '../types';

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

/** `▲ 830.43 (0.48%)`, or a dash — never a zero standing in for silence. */
function changeLabel(index: IndexSummary) {
  if (index.change === null) return '—';
  const arrow = GLYPH[directionOf(index.change)];
  const percent = index.changePercent === null ? '' : ` (${index.changePercent.toFixed(2)}%)`;
  return `${arrow} ${Math.abs(index.change).toFixed(2)}${percent}`;
}

/** One tile. Kept as a component so the featured tile and the rest cannot drift apart. */
function IndexTile({
  index, featured = false, magnitude,
}: { index: IndexSummary; featured?: boolean; magnitude: number }) {
  const direction = directionOf(index.changePercent ?? index.change);
  const tone = toneOf(direction);

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        ...(featured ? { borderColor: 'primary.main', borderWidth: 2 } : {}),
      }}
    >
      {/* A real link, not a clickable box: the board is a list of destinations, and this way it
          works with the keyboard, with a middle-click, and with "open in new tab". */}
      <CardActionArea
        component={RouterLink}
        to={`/indices/${index.symbol}`}
        sx={{ height: '100%', p: 1.25, alignItems: 'stretch' }}
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
          alignItems="baseline"
          justifyContent="space-between"
          spacing={1}
          sx={{ pr: featured ? 10 : 0 }}
        >
          <Typography variant="body2" fontWeight={700} noWrap>
            {index.symbol}
          </Typography>
          <Typography
            variant="body2"
            fontWeight={700}
            sx={{ color: tone.ink, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
          >
            {index.changePercent === null ? '—' : `${GLYPH[direction]} ${Math.abs(index.changePercent).toFixed(2)}%`}
          </Typography>
        </Stack>

        <Typography
          variant={featured ? 'h5' : 'h6'}
          sx={{ mt: 0.75, fontVariantNumeric: 'tabular-nums', letterSpacing: featured ? '-.5px' : undefined }}
        >
          {index.value === null ? '—' : formatLevel(index.value)}
        </Typography>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.25, fontVariantNumeric: 'tabular-nums' }}
        >
          {index.previousClose === null ? 'prev close —' : `prev close ${formatLevel(index.previousClose)}`}
          {index.change === null ? '' : ` · ${changeLabel(index)}`}
        </Typography>

        {/* How big this move is against the day's biggest, so the numbers do not have to be
            compared by eye. Decorative: the figures above carry the same information, so it is
            hidden from assistive tech rather than announced twice. */}
        <Tooltip title={`Move is ${Math.round(magnitude)}% of the board's largest`} arrow>
          <Box
            aria-hidden
            sx={{ mt: 1, height: 4, borderRadius: 2, bgcolor: 'divider', overflow: 'hidden' }}
          >
            <Box
              sx={{
                width: `${magnitude}%`,
                height: '100%',
                bgcolor: tone.bar,
                transition: 'width 240ms ease',
              }}
            />
          </Box>
        </Tooltip>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: 'block',
            mt: 0.75,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={index.name}
        >
          {index.name}
        </Typography>
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

  const counts = useMemo(() => {
    const list = indices ?? [];
    return {
      up: list.filter((i) => i.changePercent !== null && i.changePercent > 0).length,
      down: list.filter((i) => i.changePercent !== null && i.changePercent < 0).length,
      flat: list.filter((i) => i.changePercent === 0).length,
      unknown: list.filter((i) => i.changePercent === null).length,
    };
  }, [indices]);

  const magnitudeOf = useMemo(() => {
    // Against the day's largest move, so the bars compare within this snapshot — a bar is a
    // comparison, and a comparison against a fixed scale would be a different claim.
    const largest = Math.max(0, ...(indices ?? []).map((i) => Math.abs(i.changePercent ?? 0)));
    return (index: IndexSummary) => {
      if (largest === 0 || index.changePercent === null) return 0;
      return Math.max(4, Math.round((Math.abs(index.changePercent) / largest) * 100));
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
            <Grid item xs={12} sm={12} md={6} lg={4}>
              <IndexTile index={featured} featured magnitude={magnitudeOf(featured)} />
            </Grid>
            {rest.map((index) => (
              <Grid item xs={12} sm={6} md={3} key={index.symbol}>
                <IndexTile index={index} magnitude={magnitudeOf(index)} />
              </Grid>
            ))}
          </Grid>

          <Divider sx={{ mt: 1.5, mb: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            {featured.symbol === 'KSE100'
              ? 'KSE-100 shown first · every index the exchange publishes · tap one to open its chart.'
              : 'Every index the exchange publishes · tap one to open its chart.'}
          </Typography>
        </>
      )}
    </Box>
  );
}
