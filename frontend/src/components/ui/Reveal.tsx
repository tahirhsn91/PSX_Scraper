import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Reveal a block as it scrolls into view.
 *
 * Adapted from the `animation-on-scroll` skill's reveal-on-entry pattern to this app, which is
 * React + MUI rather than Tailwind: the skill's paused-keyframe + document-level script becomes a
 * state flag and a transition, kept inside the component.
 *
 * It deliberately uses a scroll/resize check rather than the skill's IntersectionObserver. An
 * observer only reports *changes* in intersection, and this app scrolls by jumps as well as by
 * hand — the stock page's quick-jump moves several screens in one frame, and a reload restores a
 * scroll position mid-page. A jump from "above" to "below" never intersects, so the observer never
 * fires and the blocks it passed stay hidden until the reader scrolls back into them. A cheap rect
 * check (rAF-coalesced, four to six blocks per page) catches both and behaves identically when the
 * reader scrolls normally.
 *
 * Three more deliberate differences from the skill's defaults, because this is a data product:
 *
 * - **A block already on screen at mount never hides.** The layout effect measures before paint,
 *   so nothing above the fold flashes in late — the skill lists "already in view before observer
 *   init" as a pitfall; measuring first removes it rather than papering over it with a timeout.
 * - **16px and 460ms, not 30px / 800ms / blur(8px).** A blurred, half-second slide on a 900px
 *   card is a full-screen repaint per frame on a page that already has a chart and a table; the
 *   blur filter is the expensive part and earns nothing on text that is about to be read.
 * - **Once, never again.** A section that re-animates every time it is scrolled past turns reading
 *   a long page into a slideshow.
 *
 * `prefers-reduced-motion` is handled twice: the layout effect never hides anything, and the
 * theme zeroes the transition if it slips through.
 */

export interface RevealProps {
  children: ReactNode;
  /** Extra delay before the transition starts, for blocks that enter together. */
  delay?: number;
  /** How far the block rises, in pixels. */
  distance?: number;
  sx?: SxProps<Theme>;
}

/** The share of the viewport a block's top must cross before it starts revealing. */
const TRIGGER = 0.92;

export function Reveal({ children, delay = 0, distance = 16, sx }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Visible for the first paint. The layout effect below hides it before the browser paints only
  // if it is genuinely below the fold.
  const [visible, setVisible] = useState(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const inView = () => element.getBoundingClientRect().top <= window.innerHeight * TRIGGER;
    if (inView()) return;

    setVisible(false);

    let frame = 0;
    const cleanup = () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      if (frame) cancelAnimationFrame(frame);
    };
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!inView()) return;
        setVisible(true);
        cleanup();
      });
    };

    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return cleanup;
  }, []);

  return (
    <Box
      ref={ref}
      // Exposed for verification and debugging: which blocks are still waiting for the scroll.
      data-reveal={visible ? 'shown' : 'hidden'}
      sx={[
        {
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : `translateY(${distance}px)`,
          transition: visible
            ? (theme: Theme) =>
                `opacity 460ms ${theme.app.motion.easing} ${delay}ms, transform 460ms ${theme.app.motion.easing} ${delay}ms`
            : 'none',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}
