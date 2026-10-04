import { ReactNode, useState } from 'react';
import { Box } from '@mui/material';
import { AppHeader } from './shell/AppHeader';
import { BottomNav } from './shell/BottomNav';
import { SearchSheet } from './shell/SearchSheet';
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
        {children}
      </Box>

      <BottomNav onOpenSearch={openSearch} />
      <SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Box>
  );
}
