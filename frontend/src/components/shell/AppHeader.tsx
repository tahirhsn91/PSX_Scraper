import { AppBar, Box, Button, Container, IconButton, Stack, Toolbar, Typography } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';
import { ThemeMenu } from './ThemeMenu';
import { layout } from '../../theme/tokens';

const NAV = [
  { label: 'Dashboard', to: '/' },
  { label: 'Sync Logs', to: '/logs' },
];

/**
 * Top bar: brand, primary navigation, global search (desktop), theme control.
 *
 * Search used to exist only inside the dashboard, so a stock page had no way to search; it now
 * lives in the header everywhere and collapses to a sheet button on phones. The active nav item is
 * marked with `aria-current="page"` instead of relying on a visual variant alone.
 */
export function AppHeader({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { pathname } = useLocation();

  return (
    <AppBar position="static" component="header" sx={{ zIndex: (theme) => theme.zIndex.appBar }}>
      <Container maxWidth={false} sx={{ maxWidth: layout.contentMaxWidth, px: { xs: 2, md: 3 } }}>
        <Toolbar disableGutters sx={{ gap: 1.5 }}>
          <Typography
            component={RouterLink}
            to="/"
            variant="h6"
            sx={{ fontWeight: 700, color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}
          >
            PSX Scraper
          </Typography>

          <Box component="nav" aria-label="Primary" sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.5, ml: 1 }}>
            {NAV.map((item) => {
              const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
              return (
                <Button
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  color="inherit"
                  aria-current={active ? 'page' : undefined}
                  sx={{
                    px: 1.5,
                    minHeight: 34,
                    borderRadius: 999,
                    fontSize: '0.875rem',
                    color: active ? 'primary.main' : 'text.secondary',
                    bgcolor: active ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Box>

          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'block' }, maxWidth: 420, ml: 'auto', mr: 1 }}>
            <GlobalSearch />
          </Box>

          <Stack direction="row" spacing={0.5} sx={{ ml: { xs: 'auto', md: 0 }, alignItems: 'center' }}>
            <IconButton onClick={onOpenSearch} aria-label="Search stocks" sx={{ display: { md: 'none' } }}>
              <SearchRoundedIcon />
            </IconButton>
            <ThemeMenu />
          </Stack>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
