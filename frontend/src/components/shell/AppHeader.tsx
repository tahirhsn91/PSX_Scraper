import { useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { ThemeMenu } from './ThemeMenu';
import { layout } from '../../theme/tokens';
import { isDev } from '../../lib/env';
import { PORTFOLIO_LINK } from '../../lib/links';
import { AppMenu } from './AppMenu';

/**
 * `primary` items stay in the bar at every width; the rest move into a "More" menu below xl.
 * Nine pills plus the brand, the search control and two icon buttons overflow a 1440 bar — the
 * audit measured the strip at 853px of content in an 832px box, leaving "Sync Logs" clipped under
 * the search button. The five that stay are the once-a-day destinations; the menu names the
 * current page when you are inside it, so the bar never hides where you are.
 */
const NAV: { label: string; to: string; primary?: boolean }[] = [
  { label: 'Dashboard', to: '/', primary: true },
  { label: 'Movers', to: '/movers', primary: true },
  { label: 'Screener', to: '/screener', primary: true },
  { label: 'Sectors', to: '/sectors', primary: true },
  { label: 'Dividends', to: '/dividends', primary: true },
  { label: 'Announcements', to: '/announcements' },
  { label: 'Alerts', to: '/alerts' },
  { label: 'Watchlist', to: '/watchlist' },
  { label: 'Compare', to: '/compare' },
  ...(isDev ? [{ label: 'Sync Logs', to: '/logs' }] : []),
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
  const theme = useTheme();
  // All nine fit only on a very wide bar; below xl the extra destinations live in "More".
  const wide = useMediaQuery(theme.breakpoints.up('xl'));
  const [moreEl, setMoreEl] = useState<null | HTMLElement>(null);
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));
  const inline = NAV.filter((i) => wide || i.primary);
  const overflow = NAV.filter((i) => !(wide || i.primary));
  const overflowActive = overflow.find((i) => isActive(i.to));
  const pillSx = {
    px: { md: 1, xl: 1.5 },
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
    // 40px, matching MuiButton's default target, rather than the 34px these pills used to be.
    minHeight: 40,
    borderRadius: 999,
    fontSize: '0.875rem',
  };
  const pillColor = (active: boolean) => ({
    color: active ? 'nav.active' : 'nav.textMuted',
    bgcolor: active ? 'nav.hover' : 'transparent',
    '&:hover': { bgcolor: 'nav.hover', color: 'nav.text' },
  });

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
          <AppMenu />
          <Box
            component={RouterLink}
            to="/"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'inherit', textDecoration: 'none', flexShrink: 0 }}
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

          <Box
            component="nav"
            aria-label="Primary"
            sx={{
              // Eight pills plus the brand and the two icons do not fit a 900px bar. Rather than
              // dropping items at that width, let the strip scroll sideways with the bar hidden —
              // every destination stays reachable and the page itself never scrolls horizontally.
              display: { xs: 'none', md: 'flex' },
              gap: 0.5,
              ml: 1,
              minWidth: 0,
              overflowX: 'auto',
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            {inline.map((item) => {
              const active = isActive(item.to);
              return (
                <Button
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  color="inherit"
                  aria-current={active ? 'page' : undefined}
                  sx={{ ...pillSx, ...pillColor(active) }}
                >
                  {item.label}
                </Button>
              );
            })}
            {overflow.length > 0 && (
              <>
                <Button
                  color="inherit"
                  onClick={(e) => setMoreEl(e.currentTarget)}
                  aria-haspopup="menu"
                  aria-expanded={moreEl ? 'true' : undefined}
                  aria-current={overflowActive ? 'page' : undefined}
                  endIcon={<ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />}
                  sx={{ ...pillSx, ...pillColor(Boolean(overflowActive)), gap: 0.25 }}
                >
                  {overflowActive ? overflowActive.label : 'More'}
                </Button>
                <Menu
                  anchorEl={moreEl}
                  open={Boolean(moreEl)}
                  onClose={() => setMoreEl(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                  MenuListProps={{ 'aria-label': 'More destinations', dense: true }}
                >
                  {overflow.map((item) => (
                    <MenuItem
                      key={item.to}
                      component={RouterLink}
                      to={item.to}
                      selected={isActive(item.to)}
                      onClick={() => setMoreEl(null)}
                    >
                      {item.label}
                    </MenuItem>
                  ))}
                </Menu>
              </>
            )}
          </Box>

          {/* One search control at every width. The inline field that used to live here was squeezed
              by the nav pills to 87px on a 1280 screen, so the magnifier, the placeholder and the
              98px suggestion popup were all clipped to a sliver. A button that opens the search
              window gives the bar a label it can actually show, and the window room to breathe. */}
          <Button
            onClick={onOpenSearch}
            startIcon={<SearchRoundedIcon />}
            aria-label="Search stocks"
            sx={{
              display: { xs: 'none', lg: 'inline-flex' },
              ml: 'auto',
              mr: 1,
              flexShrink: 0,
              minHeight: 38,
              // 1.25 keeps the trigger no wider than the field it replaced (86px vs 96px): the nav
              // pills are already over their box at 1280, and search must not take the space.
              px: 1.25,
              borderRadius: 999,
              textTransform: 'none',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'nav.fieldLabel',
              bgcolor: 'nav.field',
              border: 1,
              borderColor: 'nav.fieldBorder',
              '&:hover': { bgcolor: 'nav.hover', color: 'nav.text', borderColor: 'nav.active' },
              '& .MuiButton-startIcon': { color: 'nav.fieldLabel', mr: 0.75 },
              '&:hover .MuiButton-startIcon': { color: 'nav.text' },
            }}
          >
            Search
          </Button>

          <Stack direction="row" spacing={0.5} sx={{ ml: { xs: 'auto', md: 0 }, alignItems: 'center', flexShrink: 0 }}>
            <IconButton
              onClick={onOpenSearch}
              aria-label="Search stocks"
              sx={{
                // The bottom bar already carries Search below `md`; on a 320px phone this extra
                // 44px icon pushed the toolbar 6px past the viewport. Keep it only where the
                // bottom bar is absent.
                display: { xs: 'none', sm: 'inline-flex', lg: 'none' },
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
              {...PORTFOLIO_LINK}
              disableElevation
              startIcon={<AccountBalanceWalletRoundedIcon />}
              sx={{
                // Text at sm means the label fits beside the mark; md is the tight band where the
                // eight nav pills and the search control already compete for the bar, so the CTA
                // drops to its icon there and comes back at lg.
                display: { xs: 'none', sm: 'inline-flex', md: 'none', lg: 'inline-flex' },
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
              {...PORTFOLIO_LINK}
              aria-label="Track your portfolio"
              sx={{
                display: { xs: 'inline-flex', sm: 'none', md: 'inline-flex', lg: 'none' },
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
