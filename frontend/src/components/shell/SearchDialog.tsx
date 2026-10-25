import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Box,
  Chip,
  CircularProgress,
  Dialog,
  Divider,
  IconButton,
  InputBase,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { useNavigate } from 'react-router-dom';
import { useSearch, useStocks } from '../../api/hooks';
import { track } from '../../lib/analytics';
import { DASH, GLYPH, formatNumber, formatPercent, trendOf } from '../../lib/format';
import type { SearchResult, StockListItem } from '../../types';
import { ShariahMark } from '../ui/ShariahMark';

/** How many KSE-100 members the empty state offers — the list scrolls past the fold. */
const SUGGESTIONS = 12;

const NUMERIC = { fontVariantNumeric: 'tabular-nums' } as const;

function toneOf(change: number | null | undefined) {
  const t = trendOf(change);
  if (t === 'up') return { color: 'success.main', glyph: GLYPH.up };
  if (t === 'down') return { color: 'error.main', glyph: GLYPH.down };
  return { color: 'text.secondary', glyph: GLYPH.flat };
}

/**
 * The app's search surface: one dialog, opened from the header on every breakpoint.
 *
 * It used to be two different things — a field squeezed into the navigation bar, and a full-screen
 * sheet on anything narrower. At 1280 the field fell to 87px, so the magnifier, the placeholder and
 * the suggestion popup (98px wide) were all clipped to a sliver. This replaces both with a window
 * that floats over the page, leaves the page visible behind it, and answers the first question a
 * reader has before they type: which stocks actually matter in the KSE-100.
 */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [moved, setMoved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Chrome on Linux draws overlay scrollbars that ignore ::-webkit-scrollbar and stay invisible
  // until you interact — not good enough when the list is the whole point of the screen. The rail is
  // drawn by hand and positioned straight on the DOM, so no render is needed to keep it honest.

  // A fresh search every time it opens, and no stale keystrokes left behind.
  useEffect(() => {
    if (!open) {
      setInput('');
      setDebounced('');
      setActive(0);
      setMoved(false);
      return;
    }
    // The dialog moves focus to its paper on open, so `autoFocus` loses. Focus the field on the
    // frame after it appears, or the first keystroke goes nowhere.
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 220);
    return () => clearTimeout(t);
  }, [input]);

  const enabled = debounced.length >= 2;
  const { data, isFetching } = useSearch(enabled ? debounced : '');
  const results: SearchResult[] = enabled ? (data?.results ?? []) : [];

  // Recommendations are the index itself: the KSE-100 ordered by published weight, so the list
  // means something on a day when the reader has no symbol in mind.
  const { data: index, isLoading: indexLoading } = useStocks(
    1,
    SUGGESTIONS,
    false,
    'weight',
    'desc',
    undefined,
    'KSE100',
  );
  const suggestions: StockListItem[] = index?.items ?? [];

  // Whatever is on screen is one list: the recommendations while the query is too short to search,
  // the results after that. Arrows walk it either way, which is why the empty state is usable from
  // the keyboard and not just with a mouse.
  useEffect(() => {
    setActive(0);
    setMoved(false);
  }, [debounced]);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  const openResult = (r: SearchResult, position: number) => {
    // Position only: which result someone chose, never which stock it was.
    track('search_result_selected', { position });
    go(`/stocks/${r.symbol}`);
  };

  const count = enabled ? results.length : suggestions.length;

  // The dialog's children mount after `open` flips, so the first pass usually finds nothing. Retry
  // for a few frames, then keep the rail in step with scrolling and with rows arriving.
  useEffect(() => {
    if (!open) return;
    let teardown: (() => void) | undefined;
    let frame = 0;

    const start = () => {
      const el = document.getElementById('search-dialog-list');
      const rail = document.querySelector<HTMLElement>('[data-testid="search-scroll-rail"]');
      const bar = rail?.firstElementChild as HTMLElement | null;
      if (!el || !rail || !bar) {
        if (frame++ < 30) requestAnimationFrame(start);
        return;
      }
      const sync = () => {
        const view = el.clientHeight;
        const total = el.scrollHeight;
        if (total <= view + 1) {
          rail.style.display = 'none';
          return;
        }
        rail.style.display = 'block';
        const height = (view / total) * 100;
        bar.style.height = `${height}%`;
        bar.style.top = `${(el.scrollTop / (total - view)) * (100 - height)}%`;
      };
      sync();
      el.addEventListener('scroll', sync, { passive: true });
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      const mo = new MutationObserver(sync);
      mo.observe(el, { childList: true, subtree: true });
      teardown = () => {
        el.removeEventListener('scroll', sync);
        ro.disconnect();
        mo.disconnect();
      };
    };

    start();
    return () => teardown?.();
  }, [open, count]);



  const submit = () => {
    const typed = input.trim();
    if (enabled && results.length > 0) {
      openResult(results[Math.min(active, results.length - 1)], Math.min(active, results.length - 1));
      return;
    }
    // Empty query + Enter means nothing; a reader who has arrowed onto a recommendation means it.
    if (!enabled && moved && suggestions[active]) {
      go(`/stocks/${suggestions[active].symbol}`);
      return;
    }
    if (!typed) return;
    track('search_submitted', { resultCount: results.length, hadResults: results.length > 0 });
    go(`/search?q=${encodeURIComponent(typed)}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (count === 0) return;
      e.preventDefault();
      setMoved(true);
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + count) % count;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      // Name the dialog itself, not just the scrim: the label used to land on the Modal root
      // (role=presentation), leaving the role="dialog" paper unnamed (axe: aria-dialog-name).
      aria-labelledby="search-dialog-title"
      // A light scrim and a 3px blur: enough to push the board behind the window out of focus, not
      // enough to hide it. The page is still there — this is a lookup, not a mode.
      BackdropProps={{
        sx: (theme) => ({
          bgcolor: alpha(theme.palette.background.default, 0.2),
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }),
      }}
      PaperProps={{
        sx: {
          // Dialog's default paper margin is 32px a side, which on a 390px phone hands 64px of a
          // number table to the gutter. The margin, not the width, is what the flex row takes away.
          mx: { xs: 1.5, sm: 4 },
          // Fixed, not content-sized: the window is a place, and it should not resize as results
          // change length under the reader's hands.
          width: { xs: '100%', sm: 600 },
          maxWidth: '100%',
          borderRadius: 3,
          border: 1,
          borderColor: 'divider',
          overflow: 'hidden',
          boxShadow: 16,
        },
      }}
    >
      <Typography
        id="search-dialog-title"
        sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        Search stocks
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 2, py: 1.25 }}>
        <SearchRoundedIcon sx={{ color: 'text.secondary' }} />
        <InputBase
          inputRef={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search symbol or company"
          inputProps={{ 'aria-label': 'Search stocks', 'aria-controls': 'search-dialog-list' }}
          sx={{ flex: 1, fontSize: '1rem' }}
        />
        {isFetching ? <CircularProgress size={16} thickness={5} /> : null}
        <IconButton size="small" onClick={onClose} aria-label="Close search" sx={{ color: 'text.secondary' }}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Divider />

      <Box sx={{ position: 'relative' }}>
        <Box
          id="search-dialog-list"
          tabIndex={0}
          role="listbox"
          aria-label={enabled ? 'Search results' : 'Top weight in KSE-100'}
          sx={{
            // A fixed ceiling, not a viewport fraction: with twelve rows the list always overflows, so
            // the scrollbar is a permanent part of the window rather than appearing at some heights
            // and not others. `stable` keeps the rows from shifting when it does appear.
            // 30px sticky header + 4px padding + eight 44px rows: the fold lands between rows.
          maxHeight: { xs: '46vh', sm: 386 },
            overflowY: 'auto',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
            // No top padding: the sticky header must sit flush with the scroll box, or scrolled
            // rows peek through the strip above it.
            pt: 0,
            pb: 0.5,
          }}
        >
          {!enabled ? (
            <>
              <Stack
              direction="row"
              alignItems="baseline"
              justifyContent="space-between"
              sx={{
                px: 2,
                pt: 1,
                pb: 0.75,
                // Stays put while the twelve rows scroll under it, so the list never loses its label.
                position: 'sticky',
                top: 0,
                zIndex: 1,
                bgcolor: 'background.paper',
              }}
            >
                <Typography
                  variant="caption"
                  sx={{ letterSpacing: '0.08em', fontWeight: 700, color: 'text.secondary' }}
                >
                  TOP WEIGHT IN KSE-100
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  by index weight
                </Typography>
              </Stack>

              {indexLoading
                ? Array.from({ length: SUGGESTIONS }).map((_, i) => (
                    <Stack key={i} direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.25 }}>
                      <Skeleton variant="text" width={22} />
                      <Skeleton variant="text" width={54} />
                      <Skeleton variant="text" sx={{ flex: 1 }} />
                    </Stack>
                  ))
                : suggestions.map((s, i) => {
                    const r = s.changePercent ?? null;
                    const tone = toneOf(r);
                    return (
                      <Box
                        key={s.symbol}
                        role="option"
                        aria-selected={i === active}
                        aria-label={`${s.symbol}, ${s.companyName ?? ''}, weight ${formatNumber(s.weight)} percent`}
                        tabIndex={-1}
                        onMouseEnter={() => {
                          setActive(i);
                          setMoved(true);
                        }}
                        onClick={() => go(`/stocks/${s.symbol}`)}
                        sx={{
                          display: 'flex',
                          // On a phone the company gets its own line: three columns either clipped the
                          // name to a dozen characters or squeezed the weight chip.
                          flexWrap: { xs: 'wrap', sm: 'nowrap' },
                          justifyContent: 'flex-start',
                          alignItems: 'center',
                          columnGap: 1.5,
                          rowGap: 0.125,
                          px: 2,
                          py: 1.125,
                          // A whole number of rows in 396px: nine fit, so the fold never cuts a name
                          // in half — the tenth row starts exactly at the edge.
                          minHeight: 44,
                          cursor: 'pointer',
                          borderRadius: 1,
                          mx: 0.5,
                          bgcolor: i === active && moved ? 'action.hover' : 'transparent',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ ...NUMERIC, width: 18, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}
                        >
                          {i + 1}
                        </Typography>
                        <Typography
                            sx={{ fontWeight: 700, fontSize: '0.875rem', width: 64, display: 'flex', alignItems: 'center', gap: 0.5 }}
                          >
                            {s.symbol}
                            {s.shariahCompliant && <ShariahMark size={12} />}
                          </Typography>
                        <Typography
                          variant="body2"
                          noWrap
                          title={s.companyName ?? undefined}
                          sx={{
                            flex: { xs: '1 1 100%', sm: '1 1 0%' },
                            order: { xs: 9, sm: 0 },
                            minWidth: 0,
                            color: 'text.secondary',
                          }}
                        >
                          {s.companyName ?? DASH}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ ...NUMERIC, width: 72, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}
                        >
                          {s.currentPrice == null ? DASH : formatNumber(s.currentPrice)}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            ...NUMERIC,
                            width: 76,
                            textAlign: 'right',
                            color: tone.color,
                            fontWeight: 600,
                            // On a phone this sits at the right edge with the chip; on wider screens the
                            // company column does the pushing.
                            ml: { xs: 'auto', sm: 0 },
                          }}
                        >
                          {r == null ? DASH : `${tone.glyph} ${formatPercent(r)}`}
                        </Typography>
                        <Chip
                          size="small"
                          label={s.weight == null ? DASH : `${formatNumber(s.weight)}%`}
                          sx={{
                            ...NUMERIC,
                            width: 62,
                            height: 22,
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            bgcolor: 'action.hover',
                            color: 'text.primary',
                          }}
                        />
                      </Box>
                    );
                  })}
            </>
          ) : (
            <>
              {input.trim().length === 1 ? (
                <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 1, pb: 0.5, color: 'text.secondary' }}>
                  Type one more character to search.
                </Typography>
              ) : null}

              {!isFetching && results.length === 0 ? (
                <Box sx={{ px: 2, py: 3 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    No matches for “{debounced}”
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Try a symbol (OGDC) or part of a company name.
                  </Typography>
                </Box>
              ) : null}

              {results.map((r, i) => {
                const isActive = i === active;
                return (
                  <Box
                    key={r.symbol}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => openResult(r, i)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 2,
                      py: 1.125,
                      mx: 0.5,
                      borderRadius: 1,
                      cursor: 'pointer',
                      bgcolor: isActive ? 'action.hover' : 'transparent',
                    }}
                  >
                    <Typography
                        sx={{ fontWeight: 700, fontSize: '0.875rem', width: 72, display: 'flex', alignItems: 'center', gap: 0.5 }}
                      >
                        {r.symbol}
                        {r.shariahCompliant && <ShariahMark size={12} />}
                      </Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap title={r.companyName ?? undefined}>
                        {r.companyName ?? DASH}
                      </Typography>
                      {r.sector ? (
                        <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
                          {r.sector}
                        </Typography>
                      ) : null}
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{ ...NUMERIC, width: 72, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}
                    >
                      {r.currentPrice == null ? DASH : formatNumber(r.currentPrice)}
                    </Typography>
                    <ArrowForwardRoundedIcon
                      sx={{
                        fontSize: 16,
                        color: 'text.secondary',
                        display: { xs: 'none', sm: 'block' },
                        visibility: isActive ? 'visible' : 'hidden',
                      }}
                    />
                  </Box>
                );
              })}

            </>
          )}
        </Box>

        <Box
          aria-hidden
          data-testid="search-scroll-rail"
          sx={{
            display: 'none',
            position: 'absolute',
            top: 6,
            bottom: 6,
            right: 3,
            width: 4,
            borderRadius: 2,
            bgcolor: (theme) => alpha(theme.palette.text.primary, 0.08),
            pointerEvents: 'none',
          }}
        >
          <Box
            data-testid="search-scroll-thumb"
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              borderRadius: 2,
              bgcolor: (theme) => alpha(theme.palette.text.primary, 0.38),
              transition: 'top 80ms linear',
            }}
          />
        </Box>
      </Box>

      {enabled && input.trim().length >= 2 ? (
        <Box
          role="button"
          tabIndex={-1}
          onClick={() => go(`/search?q=${encodeURIComponent(input.trim())}`)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1.125,
            cursor: 'pointer',
            borderTop: 1,
            borderColor: 'divider',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            See all results for “{input.trim()}”
          </Typography>
          <ArrowForwardRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        </Box>
      ) : null}

      <Divider />
      <Stack
        direction="row"
        spacing={2}
        sx={{ px: 2, py: 1, display: { xs: 'none', sm: 'flex' }, alignItems: 'center' }}
      >
        <Hint k="↑ ↓">move</Hint>
        <Hint k="↵">open</Hint>
        <Hint k="esc">close</Hint>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {enabled ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : 'KSE-100 weights from the last index sync'}
        </Typography>
      </Stack>
    </Dialog>
  );
}

function Hint({ k, children }: { k: string; children: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box
        component="kbd"
        sx={{
          px: 0.5,
          borderRadius: 0.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
          fontFamily: 'inherit',
          fontSize: '0.625rem',
          color: 'text.secondary',
          lineHeight: 1.7,
        }}
      >
        {k}
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {children}
      </Typography>
    </Stack>
  );
}
