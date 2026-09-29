import { AppBar, Box, Button, Container, IconButton, Stack, Toolbar, Typography, alpha } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';
import { ThemeMenu } from './ThemeMenu';
import { layout } from '../../theme/tokens';

const NAV = [
  { label: 'Dashboard', to: '/' },
  { label: 'Sync Logs', to: '/logs' },
];

/**
 * Where the portfolio manager lives.
 *
 * Overridable per environment so a dev stack can point at a dev manager, but it defaults to the live
 * one on purpose: a link that only works once someone has filled in an `.env` entry is a link that
 * breaks on the next fresh clone. Read at build time by Vite, like `VITE_API_URL`.
 */
const PORTFOLIO_URL = (import.meta.env.VITE_PORTFOLIO_URL as string) || 'https://manager.myportfolio365.com/';

/** Shared by the labelled button and the icon-only phone twin, so they can never drift apart. */
const portfolioLink = (): { component: 'a'; href: string; target: string; rel: string } => ({
  component: 'a',
  href: PORTFOLIO_URL,
  target: '_blank',
  // `noopener` blocks the new tab from reaching back through `window.opener`; `noreferrer` also drops
  // the referrer, so the manager's analytics cannot read this app's URL — including a dev host.
  rel: 'noopener noreferrer',
});

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
          <Box
            component={RouterLink}
            to="/"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'inherit', textDecoration: 'none' }}
          >
            {/* Decorative — the brand name sits right beside it, so an empty alt stops screen readers
                announcing the mark as well. 28px rendered from a 64px file so it stays crisp at 2x;
                the artwork is dense, and below about 26 the candlesticks inside the arc stop reading. */}
            <Box
              component="img"
              src="/logo-64.png"
              alt=""
              aria-hidden
              sx={{ width: 28, height: 28, display: 'block', flexShrink: 0 }}
            />
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
              PSX Scraper
            </Typography>
          </Box>

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
            {/* The one control that leaves the app, so it carries the brand colour instead of sitting
                quietly beside the theme control. Labelled from `sm` up; below that the header is brand
                plus icons only, and a full label would push the theme control off-screen — so it
                collapses to its icon rather than disappearing. */}
            <Button
              {...portfolioLink()}
              color="primary"
              variant="contained"
              disableElevation
              startIcon={<AccountBalanceWalletRoundedIcon />}
              sx={{
                display: { xs: 'none', sm: 'inline-flex' },
                borderRadius: 999,
                px: 1.75,
                minHeight: 36,
                fontSize: '0.8125rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                boxShadow: 1,
              }}
            >
              Track your portfolio
              <Box
                component="span"
                sx={{
                  ml: 0.75,
                  px: 0.5,
                  py: 0.125,
                  borderRadius: 999,
                  fontSize: '0.625rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  lineHeight: 1.4,
                  // Tinted from the button's own contrast colour, so it stays legible in light mode
                  // (dark ink on dark green) and in dark mode (light ink on mint).
                  bgcolor: (theme) => alpha(theme.palette.primary.contrastText, 0.18),
                }}
              >
                NEW
              </Box>
            </Button>
            <IconButton
              {...portfolioLink()}
              aria-label="Track your portfolio"
              sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
            >
              <AccountBalanceWalletRoundedIcon fontSize="small" />
            </IconButton>
            <ThemeMenu />
          </Stack>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
