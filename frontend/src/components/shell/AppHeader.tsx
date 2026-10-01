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
    <AppBar
      position="static"
      component="header"
      sx={{
        zIndex: (theme) => theme.zIndex.appBar,
        // A dark navigation bar is part of the PSX identity and stays dark in both colour modes,
        // so the header must not inherit the theme's surface colour.
        bgcolor: 'nav.bg',
        color: 'nav.text',
        borderBottom: '1px solid',
        borderColor: 'nav.hover',
      }}
    >
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
            {/* The brand block: the name, with the product line under it. The mark is decorative and
                sits centred against both lines, so the pair reads as one unit. */}
            <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, letterSpacing: '-0.02em', whiteSpace: 'nowrap', lineHeight: 1.2 }}
              >
                MyPortfolio365
              </Typography>
              {/* The product line. Small on purpose — it qualifies the name rather than competing with
                  it — but not dim: `nav.textMuted` is the bar's own muted token, measured at 6.36:1
                  against the light bar and 6.63:1 against the dark one, so a 12px label is still
                  readable rather than decorative. Centred under the name it qualifies: the column is
                  as wide as the wordmark, so `center` puts it on the name's axis, not the bar's. */}
              <Typography
                component="span"
                sx={{
                  mt: 0.25,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  lineHeight: 1.2,
                  letterSpacing: '0.08em',
                  color: 'nav.textMuted',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}
              >
                Market
              </Typography>
            </Box>
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
                    color: active ? 'nav.active' : 'nav.textMuted',
                    bgcolor: active ? 'nav.hover' : 'transparent',
                    '&:hover': { bgcolor: 'nav.hover', color: 'nav.text' },
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Box>

          {/* The field is its own surface on top of the dark bar. Left to inherit, an outlined input
              would draw a near-black border on a near-black bar. */}
          <Box
            sx={{
              flexGrow: 1,
              display: { xs: 'none', md: 'block' },
              maxWidth: 420,
              ml: 'auto',
              mr: 1,
              '& .MuiOutlinedInput-root': {
                bgcolor: 'nav.field',
                '& fieldset': { borderColor: 'nav.fieldBorder' },
                '&:hover fieldset': { borderColor: 'nav.fieldBorder' },
                '&.Mui-focused fieldset': { borderColor: 'nav.active' },
              },
              '& .MuiInputBase-input': { color: 'nav.fieldText' },
              // No label rule: the field carries no visible label, because an MUI label here straddles
              // the field's fill and the bar behind it — two backgrounds, and no single colour passes
              // against both. The icon and the placeholder are inside the field, on its fill alone.
              '& .MuiInputBase-input::placeholder': { color: 'nav.fieldLabel', opacity: 1 },
              '& .MuiInputAdornment-root .MuiSvgIcon-root': { color: 'nav.fieldLabel' },
            }}
          >
            <GlobalSearch />
          </Box>

          <Stack direction="row" spacing={0.5} sx={{ ml: { xs: 'auto', md: 0 }, alignItems: 'center' }}>
            <IconButton
              onClick={onOpenSearch}
              aria-label="Search stocks"
              sx={{
                display: { md: 'none' },
                color: 'nav.textMuted',
                '&:hover': { color: 'nav.text', bgcolor: 'nav.hover' },
              }}
            >
              <SearchRoundedIcon />
            </IconButton>
            {/* The one control that leaves the app, so it carries the brand colour instead of sitting
                quietly beside the theme control. Labelled from `sm` up; below that the header is brand
                plus icons only, and a full label would push the theme control off-screen — so it
                collapses to its icon rather than disappearing. */}
            <Button
              {...portfolioLink()}
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
                // Its own colour pair rather than the page's primary: on the dark bar a dark green
                // fill separates from the bar at only 1.89:1, so this button inverts instead.
                bgcolor: 'nav.cta',
                color: 'nav.ctaText',
                '&:hover': { bgcolor: 'nav.cta', filter: 'brightness(0.95)' },
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
                  // Tinted from the button's own label colour, so it stays legible whichever way the
                  // button is inverted.
                  bgcolor: (theme) => alpha(theme.palette.nav.ctaText, 0.16),
                }}
              >
                NEW
              </Box>
            </Button>
            <IconButton
              {...portfolioLink()}
              aria-label="Track your portfolio"
              sx={{
                display: { xs: 'inline-flex', sm: 'none' },
                bgcolor: 'nav.cta',
                color: 'nav.ctaText',
              }}
            >
              <AccountBalanceWalletRoundedIcon fontSize="small" />
            </IconButton>
            {/* The theme control inherits `action.active`, which is tuned for a light surface. */}
            <Box
              sx={{
                display: 'flex',
                '& .MuiIconButton-root': { color: 'nav.textMuted' },
                '& .MuiIconButton-root:hover': { color: 'nav.text', bgcolor: 'nav.hover' },
              }}
            >
              <ThemeMenu />
            </Box>
          </Stack>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
