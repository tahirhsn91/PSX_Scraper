import { useEffect, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';

export interface QuickJumpSection {
  id: string;
  label: string;
}

interface QuickJumpNavProps {
  sections: QuickJumpSection[];
  /**
   * Reports the total sticky offset (header + nav + gap) in px so the page can set each
   * section's `scroll-margin-top` and a smooth jump lands below both bars.
   */
  onOffsetChange?: (px: number) => void;
}

/** The id Layout puts on its sticky header wrapper — the bar this nav must sit below. */
const HEADER_ID = 'app-header';
/** Breathing room between the bottom of the nav and the top of a jumped-to section. */
const GAP = 8;

/**
 * A sticky "quick-jump" nav: stays under the app header, auto-highlights the section currently
 * in view as the page scrolls, and clicking a link smooth-scrolls to that section.
 *
 * Scroll-spy rule: the last section whose top edge has passed under the sticky bars is the active
 * one — i.e. the section the reader is looking at. Measurement is live (ResizeObserver + resize),
 * never a hard-coded header height, so it tracks the banner + app bar in both modes.
 */
export function QuickJumpNav({ sections, onOffsetChange }: QuickJumpNavProps) {
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string>(sections[0]?.id ?? '');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [navHeight, setNavHeight] = useState(0);

  useEffect(() => {
    const header = document.getElementById(HEADER_ID);
    const measure = () => {
      setHeaderHeight(header ? Math.round(header.getBoundingClientRect().height) : 0);
      if (navRef.current) setNavHeight(Math.round(navRef.current.getBoundingClientRect().height));
    };
    measure();

    const ro = new ResizeObserver(measure);
    if (header) ro.observe(header);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener('resize', measure);
    // Re-measure once fonts/layout have settled.
    const t = window.setTimeout(measure, 300);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.clearTimeout(t);
    };
  }, []);

  const offset = headerHeight + navHeight + GAP;

  useEffect(() => {
    onOffsetChange?.(offset);
  }, [offset, onOffsetChange]);

  // Scroll-spy: which section's top has last crossed under the sticky bars.
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      let current = sections[0]?.id ?? '';
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= offset) current = s.id;
      }
      // Bottom of page: a short final section never scrolls its top up to the sticky line, so
      // once the page can scroll no further, the last section is the one being read.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) current = sections[sections.length - 1]?.id ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections, offset]);

  const jump = (id: string) => {
    // The section's own `scroll-margin-top` (set by the page from `offset`) absorbs the
    // header + nav, so block:'start' lands the section just below both bars.
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Box
      ref={navRef}
      component="nav"
      aria-label="Stock detail sections"
      sx={{
        position: 'sticky',
        top: headerHeight,
        zIndex: (theme) => theme.zIndex.appBar - 1,
        display: 'flex',
        gap: 0.5,
        overflowX: 'auto',
        bgcolor: 'background.default',
        borderBottom: 1,
        borderColor: 'divider',
        py: 0.5,
      }}
    >
      {sections.map((s) => {
        const isActive = s.id === active;
        return (
          <Button
            key={s.id}
            size="small"
            onClick={() => jump(s.id)}
            aria-current={isActive ? 'true' : undefined}
            sx={{
              flexShrink: 0,
              minWidth: 0,
              px: 1.25,
              color: isActive ? 'primary.main' : 'text.secondary',
              fontWeight: isActive ? 600 : 400,
              borderBottom: '2px solid',
              borderBottomColor: isActive ? 'primary.main' : 'transparent',
              borderRadius: 0,
            }}
          >
            {s.label}
          </Button>
        );
      })}
    </Box>
  );
}
