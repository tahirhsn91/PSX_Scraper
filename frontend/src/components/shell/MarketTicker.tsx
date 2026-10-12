import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useIndices, useMarketOverview } from '../../api/hooks';
import { GLYPH, formatNumber, formatPercent, formatSigned, trendOf } from '../../lib/format';

/**
 * The market tape that sits under the header.
 *
 * It carries the KSE-100 level and the session's biggest movers, in one line, moving left to right.
 * Both feeds are re-read on the same live cadence the index board uses (`LIVE_MS`), so the tape is
 * as current as the scrape behind it — which is minutes, not seconds, and that is what "real time"
 * honestly means here.
 *
 * Everything is drawn on `background.paper`, not on the dark navigation bar above it. The trend
 * colours (`up.main` / `down.main`) are contrast-verified against a surface; on the charcoal bar the
 * light mode's `#007A42` would sit at roughly 1.3:1 and be unreadable.
 */

/** How many of each side the tape carries. The API publishes five; three keeps the loop short. */
const TOP_N = 3;

/** Seconds one entry takes to cross the tape, used to size the whole animation. */
const SECONDS_PER_ENTRY = 4;

/** The live cadence, matching the index board's own interval. */
const LIVE_MS = 30000;

/** Palette path for a change: the two trend colours, or the muted text colour when nothing moved. */
const colourFor = (changePercent: number | null | undefined): string => {
  const trend = trendOf(changePercent);
  return trend === 'up' ? 'up.main' : trend === 'down' ? 'down.main' : 'text.secondary';
};

/** The strip itself: a surface, with the tape held and the motion rules attached. */
const stripSx = {
  bgcolor: 'background.paper',
  borderBottom: '1px solid',
  borderColor: 'divider',
  overflow: 'hidden',
  // A reader who asked for less motion gets the same figures as a strip they can scroll, rather than
  // a tape that never stops.
  '@media (prefers-reduced-motion: reduce)': {
    overflowX: 'auto',
    '& .ticker-track': { animation: 'none', transform: 'none' },
  },
  // Hovering or focusing the tape holds it still, so an entry can be read (or reached) without
  // chasing it.
  '&:hover .ticker-track, &:focus-within .ticker-track': { animationPlayState: 'paused' },
  '@keyframes ticker-ltr': {
    from: { transform: 'translateX(-50%)' },
    to: { transform: 'translateX(0)' },
  },
};

type Entry =
  | { kind: 'heading'; key: string; text: string }
  | {
      kind: 'quote';
      key: string;
      /** The name shown first: `KSE-100` for the index, otherwise the symbol. */
      label: string;
      to: string;
      value: number | null;
      /** The point move. Only the index publishes one; the quotes show the percentage alone. */
      change?: number | null;
      changePercent: number | null;
    };

/** One entry. `duplicate` marks the second pass of the tape, which is hidden from assistive tech. */
function TickerEntry({ entry, duplicate }: { entry: Entry; duplicate: boolean }) {
  if (entry.kind === 'heading') {
    return (
      <Typography
        component="span"
        variant="caption"
        sx={{
          px: 1.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'text.secondary',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.text}
      </Typography>
    );
  }

  const trend = trendOf(entry.changePercent);
  const colour = colourFor(entry.changePercent);

  return (
    <Box
      component={RouterLink}
      to={entry.to}
      // The second pass is a visual repeat, so it must not add a second set of tab stops.
      tabIndex={duplicate ? -1 : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        whiteSpace: 'nowrap',
        textDecoration: 'none',
        color: 'inherit',
        borderRadius: 0.5,
        '&:hover .ticker-symbol': { textDecoration: 'underline' },
      }}
    >
      <Typography component="span" variant="caption" className="ticker-symbol" sx={{ fontWeight: 700, color: 'text.primary' }}>
        {entry.label}
      </Typography>
      <Typography
        component="span"
        variant="caption"
        sx={{ fontWeight: 600, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}
      >
        {formatNumber(entry.value)}
      </Typography>
      {entry.change != null && (
        <Typography component="span" variant="caption" sx={{ color: colour, fontVariantNumeric: 'tabular-nums' }}>
          {formatSigned(entry.change)}
        </Typography>
      )}
      {/* Direction carries the glyph as well as the colour, so it survives greyscale and colour
          blindness — the same rule the change pills follow. */}
      {trend && (
        <Box component="span" aria-hidden sx={{ color: colour, fontSize: '0.7em', lineHeight: 1 }}>
          {GLYPH[trend]}
        </Box>
      )}
      <Typography
        component="span"
        variant="caption"
        sx={{ fontWeight: 600, color: colour, fontVariantNumeric: 'tabular-nums' }}
      >
        {formatPercent(entry.changePercent)}
      </Typography>
    </Box>
  );
}

export function MarketTicker() {
  const { data: overview, isLoading: moversLoading } = useMarketOverview(LIVE_MS);
  const { data: indices } = useIndices(true);

  const entries = useMemo(() => {
    const out: Entry[] = [];

    const kse100 = (indices?.items ?? []).find((i) => i.symbol === 'KSE100');
    if (kse100) {
      out.push({
        kind: 'quote',
        key: 'index-KSE100',
        label: 'KSE-100',
        to: '/indices/KSE100',
        value: kse100.value,
        change: kse100.change,
        changePercent: kse100.changePercent,
      });
    }

    const gainers = (overview?.movers.gainers ?? []).slice(0, TOP_N);
    const losers = (overview?.movers.losers ?? []).slice(0, TOP_N);

    if (gainers.length > 0) out.push({ kind: 'heading', key: 'head-gainers', text: 'Top gainers' });
    for (const m of gainers) {
      out.push({
        kind: 'quote',
        key: `gain-${m.symbol}`,
        label: m.symbol,
        to: `/stocks/${m.symbol}`,
        value: m.currentPrice,
        changePercent: m.changePercent,
      });
    }

    if (losers.length > 0) out.push({ kind: 'heading', key: 'head-losers', text: 'Top losers' });
    for (const m of losers) {
      out.push({
        kind: 'quote',
        key: `lose-${m.symbol}`,
        label: m.symbol,
        to: `/stocks/${m.symbol}`,
        value: m.currentPrice,
        changePercent: m.changePercent,
      });
    }

    return out;
  }, [indices, overview]);

  if (entries.length === 0) {
    // Nothing to report yet: keep the strip (and so the header's height) for the first paint, but do
    // not leave a permanent empty band if the feed never answers.
    if (!moversLoading) return null;
    return (
      <Box component="section" aria-label="Today's market movers" sx={stripSx}>
        <Typography variant="caption" sx={{ px: 2, py: 0.75, display: 'block', color: 'text.secondary' }}>
          Loading today&apos;s movers…
        </Typography>
      </Box>
    );
  }

  // Two identical passes: the animation slides the track by exactly half its width, so the second
  // pass lands where the first began and the seam is invisible.
  const duration = Math.max(4, entries.length) * SECONDS_PER_ENTRY;

  return (
    <Box component="section" aria-label="Today's market movers" sx={stripSx}>
      <Box
        className="ticker-track"
        sx={{
          display: 'flex',
          alignItems: 'center',
          width: 'max-content',
          py: 0.75,
          // No flex `gap`: the spacing lives inside each entry, so the two passes concatenate to
          // exactly double one pass and the -50% slide lines up on the pixel.
          animation: `ticker-ltr ${duration}s linear infinite`,
          willChange: 'transform',
        }}
      >
        {entries.map((e) => (
          <TickerEntry key={e.key} entry={e} duplicate={false} />
        ))}
        {/* The visual repeat. Hidden from assistive tech so the tape is not read out twice. */}
        <Box sx={{ display: 'contents' }} aria-hidden>
          {entries.map((e) => (
            <TickerEntry key={`dup-${e.key}`} entry={e} duplicate />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
