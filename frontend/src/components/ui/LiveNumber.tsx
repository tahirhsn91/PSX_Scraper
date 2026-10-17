import { ReactNode, useEffect, useRef, useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { DASH } from '../../lib/format';

/**
 * A number that moves.
 *
 * The dashboard is polled, not pushed: values change under a reader who is already looking at
 * them. Without a signal that change is invisible — the figure is simply different from the one
 * remembered, and the only way to notice is to re-read every cell. This component adds the
 * smallest honest signal for that:
 *
 * - `flash` washes the value's background for 320ms when it changes, green for up and red for
 *   down, and lifts it a hair. Nothing else on the tile moves, so the eye is drawn to the figure
 *   that changed and not to the layout.
 * - `countUp` runs 0 → value once, on first arrival only. It marks "the page has settled" rather
 *   than re-animating on every poll; a number that counts up every 30 seconds is an odometer, and
 *   an odometer on a market board is noise.
 * - `pulse` is a slow breath for a live indicator (the active-syncs count while a fan-out runs).
 *
 * The flash is colour *and* direction: the caller passes the raw number, so the sign of the move
 * is known here, and it never depends on colour alone because the value itself moves.
 *
 * Performance guards, because the table below renders ~100 rows × 9 columns:
 * - Only a value that actually changed triggers anything (`before === value` returns early).
 * - Flashes share one budget (24 per 500ms across the whole page), so a sync fan-out that moves
 *   sixty prices washes twenty and leaves the rest still — a strobing table is unreadable.
 * - Everything is `background-color` and `transform`: no width, height, or position animation, so
 *   no cell ever reflows.
 * - `prefers-reduced-motion` skips the count-up and the theme already zeroes the CSS animations.
 */

/** Flashes allowed to start in any 500ms window, page-wide. */
const FLASH_BUDGET = 24;
const FLASH_WINDOW_MS = 500;
const flashStarts: number[] = [];

/** Count-up length. Long enough to read, short enough not to delay the figure. */
const COUNT_MS = 380;

/**
 * Read once, at the moment a count-up would start.
 *
 * Deliberately not `useMediaQuery`: the table renders this component in ~200 cells, and a
 * matchMedia subscription per cell (plus a re-render on every media change) is a cost paid by a
 * feature that only fires on first load. The CSS animations still follow the preference on their
 * own, because the theme zeroes them.
 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function takeFlashSlot(): boolean {
  const now = performance.now();
  while (flashStarts.length > 0 && now - flashStarts[0] > FLASH_WINDOW_MS) flashStarts.shift();
  if (flashStarts.length >= FLASH_BUDGET) return false;
  flashStarts.push(now);
  return true;
}

export type FlashDirection = 'up' | 'down';

export interface FlashState {
  direction: FlashDirection;
  /** Increments on every flash, so it can be used as a `key` to restart the animation. */
  key: number;
}

/**
 * The change detector behind `LiveNumber` and `ChangePill`.
 *
 * Returns the direction of the most recent change (or `null`), and a counter that changes with it.
 * The first value a component ever sees does not flash: mounting is not a change, and a fresh page
 * load washing every tile green would say the market moved when it did not.
 */
export function useFlashTrigger(
  value: number | null | undefined,
  enabled: boolean,
): FlashState | null {
  const previous = useRef<number | null | undefined>(undefined);
  const [state, setState] = useState<FlashState | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (!enabled || value == null || before == null || before === value) return;
    if (!takeFlashSlot()) return;
    setState((current) => ({
      direction: value > before ? 'up' : 'down',
      key: (current?.key ?? 0) + 1,
    }));
  }, [value, enabled]);

  return state;
}

export interface LiveNumberProps {
  /** The raw number. `null`/`undefined` renders the fallback and never animates. */
  value: number | null | undefined;
  /** Formats the number for display; also used for the intermediate frames of a count-up. */
  format: (value: number) => string;
  /** Count from zero the first time a value arrives. Never on later changes. */
  countUp?: boolean;
  /** Wash the background on a value change (green up, red down). */
  flash?: boolean;
  /** Breathe slowly while `true` — for a live indicator, not for decoration. */
  pulse?: boolean;
  /** Rendered when the value is missing. Defaults to the app's dash. */
  fallback?: ReactNode;
  title?: string;
}

export function LiveNumber({
  value,
  format,
  countUp = false,
  flash = false,
  pulse = false,
  fallback = DASH,
  title,
}: LiveNumberProps) {
  const theme = useTheme();
  const flashState = useFlashTrigger(value, flash);

  const [shown, setShown] = useState<number | null>(value ?? null);
  const counted = useRef(false);

  useEffect(() => {
    if (value == null) {
      setShown(null);
      return;
    }
    if (!countUp || prefersReducedMotion() || counted.current) {
      counted.current = true;
      setShown(value);
      return;
    }
    counted.current = true;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(value * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, countUp]);

  if (value == null) return <>{fallback}</>;

  const text = format(shown ?? value);

  const number = (
    <Box
      component="span"
      // A new key per flash remounts the span, which is the one reliable way to restart a CSS
      // animation without reaching into the DOM with a reflow hack.
      key={flashState?.key ?? 'steady'}
      title={title}
      sx={{
        display: 'inline-block',
        px: '2px',
        mx: '-2px',
        borderRadius: '4px',
        fontVariantNumeric: 'tabular-nums',
        animation:
          flashState == null
            ? undefined
            : `${flashState.direction === 'up' ? 'live-flash-up' : 'live-flash-down'} 320ms ${theme.app.motion.easing}`,
        '@keyframes live-flash-up': {
          '0%': { backgroundColor: theme.palette.up.soft, transform: 'translateY(-1px)' },
          '100%': { backgroundColor: 'transparent', transform: 'none' },
        },
        '@keyframes live-flash-down': {
          '0%': { backgroundColor: theme.palette.down.soft, transform: 'translateY(1px)' },
          '100%': { backgroundColor: 'transparent', transform: 'none' },
        },
      }}
    >
      {text}
    </Box>
  );

  // The pulse lives on an outer span so a flash on the inner one cannot cancel it: both are CSS
  // animations, and two `animation` declarations on one element would mean only the last survives.
  if (!pulse) return number;

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        animation: 'live-pulse 2.2s ease-in-out infinite',
        '@keyframes live-pulse': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.6 },
        },
      }}
    >
      {number}
    </Box>
  );
}
