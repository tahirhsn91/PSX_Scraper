import {
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Stack,
  Toolbar,
  Typography,
  alpha,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import { Link as RouterLink } from 'react-router-dom';
import { ThemeMenu } from './ThemeMenu';
import { layout } from '../../theme/tokens';
import { PORTFOLIO_LINK } from '../../lib/links';
import { AppMenu } from './AppMenu';

/**
 * Top bar: the menu button, the logo centred, the actions on the right.
 *
 * The bar carries no destinations of its own. Every page — Dashboard, Movers, Screener, Sectors,
 * Dividends, Announcements, Watchlist, Alerts, Compare, Sync Logs and ROI — lives in the drawer
 * (`AppMenu`), which is now the single index of the app. Keeping a second copy here meant two lists
 * to keep in step, a "More" overflow for the pills that stopped fitting, and a strip that fought the
 * search control for width at 1280. The logo is the bar's centre now and its only claim about
 * identity; the drawer says where you can go, and the page heading says where you are.
 */
export function AppHeader({ onOpenSearch }: { onOpenSearch: () => void }) {
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
        <Toolbar
          disableGutters
          sx={{
            // Three tracks, the outer two equal, so the brand lands on the bar's exact centre line
            // instead of on the centre of whatever the icons left over. `minmax(0, 1fr)` lets those
            // outer tracks shrink rather than push the brand off-centre on a narrow phone.
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            alignItems: 'center',
            columnGap: 1,
            minHeight: { xs: 60, md: 68 },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', minWidth: 0 }}>
            <AppMenu />
          </Box>

          <Box
            component={RouterLink}
            to="/"
            aria-label="MyPortfolio365 — go to the dashboard"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              color: 'inherit',
              textDecoration: 'none',
              flexShrink: 0,
              justifySelf: 'center',
            }}
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
                  readable rather than decorative. Centred under the name: the column is as wide as
                  the wordmark, so `center` puts it on the name's axis, not the bar's. */}
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

          <Stack
            direction="row"
            spacing={0.5}
            sx={{ justifyContent: 'flex-end', alignItems: 'center', minWidth: 0 }}
          >
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
                mr: 1,
                flexShrink: 0,
                minHeight: 38,
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
                quietly beside the theme control. Labelled from `sm` up; between md and lg the label
                would crowd the search control, so it drops to its icon rather than disappearing. On
                phones it is the icon form only — the drawer also lists the portfolio manager, so the
                header does not need to spell it out at 360px. */}
            <Button
              {...PORTFOLIO_LINK}
              disableElevation
              startIcon={<AccountBalanceWalletRoundedIcon />}
              sx={{
                display: { xs: 'none', sm: 'none', md: 'inline-flex' },
                borderRadius: 999,
                px: 1.75,
                minHeight: 36,
                fontSize: '0.8125rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                // Its own colour pair rather than the page's primary: on the dark bar a dark green fill
                // separates from the bar at only 1.89:1, so this button inverts instead.
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
                display: { xs: 'none', sm: 'inline-flex', md: 'none' },
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
