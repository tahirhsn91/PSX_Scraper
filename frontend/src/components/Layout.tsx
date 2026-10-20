import { ReactNode, useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { AppHeader } from './shell/AppHeader';
import { MarketTicker } from './shell/MarketTicker';
import { BottomNav } from './shell/BottomNav';
import { SearchDialog } from './shell/SearchDialog';
import { EnvBanner } from './EnvBanner';
import { layout } from '../theme/tokens';

/**
 * The app shell: sticky banner + header, main content, mobile bottom navigation, search sheet.
 *
 * The red dev banner and the app bar still share one sticky wrapper — the banner is pinned by its
 * parent rather than by a hard-coded header offset, which is what keeps it visible on every route
 * in this checkout.
 */
export function Layout({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = () => setSearchOpen(true);

  // ⌘K / Ctrl+K from anywhere: the window is the app's only search, so it gets the shortcut a
  // reader reaches for before they look for a magnifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      const chord = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      // "/" is the shortcut that survives the browser: Chrome takes Ctrl+K for its own address bar,
      // so the chord is a bonus where it works and the slash is the one to rely on.
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing;
      if (chord || slash) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Only the path, not the query: the screener's filters live in the query string and moving a
  // filter must not remount the page (and replay the entrance) under the reader.
  const { pathname } = useLocation();

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main"
        sx={{
          position: 'absolute',
          left: -9999,
          '&:focus': {
            left: 8,
            top: 8,
            zIndex: (theme) => theme.zIndex.tooltip + 1,
            bgcolor: 'background.paper',
            color: 'text.primary',
            px: 2,
            py: 1,
            borderRadius: 1,
            boxShadow: 2,
          },
        }}
      >
        Skip to content
      </Box>

      <Box id="app-header" sx={{ position: 'sticky', top: 0, zIndex: (theme) => theme.zIndex.appBar }}>
        <EnvBanner />
        <AppHeader onOpenSearch={openSearch} />
        {/* Inside the sticky wrapper, so the tape stays on screen and the pages that measure
            `#app-header` (the stock page's quick-jump) pick its height up automatically. */}
        <MarketTicker />
      </Box>

      <Box
        component="main"
        id="main"
        sx={{
          maxWidth: layout.contentMaxWidth,
          mx: 'auto',
          px: { xs: 2, md: 3 },
          py: { xs: 2, md: 3 },
          // Clearance for the fixed bottom navigation on phones.
          pb: { xs: 9, md: 4 },
        }}
      >
        {/* Keyed by path so a route change starts from a 6px lift and a fade (180ms) instead of
            replacing the page between two frames. The keyframes are the shell's own, not the
            page's: every route inherits the same entrance, and reduced motion zeroes it at the
            theme level. */}
        <Box
          key={pathname}
          sx={{
            animation: (theme) => `route-in 180ms ${theme.app.motion.easing}`,
            '@keyframes route-in': {
              from: { opacity: 0, transform: 'translateY(6px)' },
              to: { opacity: 1, transform: 'none' },
            },
          }}
        >
          {children}
        </Box>
      </Box>

      <BottomNav onOpenSearch={openSearch} />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Box>
  );
}
