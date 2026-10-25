import { useState, type ReactNode } from 'react';
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  SvgIcon,
  Typography,
  type SvgIconProps,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SpaceDashboardRoundedIcon from '@mui/icons-material/SpaceDashboardRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded';
import PieChartRoundedIcon from '@mui/icons-material/PieChartRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { isDev } from '../../lib/env';
import { PORTFOLIO_LINK } from '../../lib/links';

/**
 * Three bars with the middle one stopping short on the right — the "fries" menu mark.
 *
 * Hand-drawn rather than MUI's `MenuRounded` so the middle bar can be clipped independently: at
 * 24px a 3.5px difference is visible without making the button look like a different icon set. The
 * stroke, caps and optical size match MUI's rounded set, so it sits beside the other icons
 * unchanged.
 */
function FriesMenuIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path
        d="M3.5 6.5h17M3.5 12h13.5M3.5 17.5h17"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

interface MenuItem {
  label: string;
  /** Router path for a page in this app. */
  to?: string;
  /** External anchor; takes precedence over `to`. */
  link?: typeof PORTFOLIO_LINK;
  icon: ReactNode;
}

/**
 * The drawer's contents, in section order.
 *
 * **New features go here.** Add a `{ label, to, icon }` to the section it belongs in — the button in
 * the corner, the active state, the phone close behaviour and the external-link handling are already
 * wired, so an entry is one line. Nothing in this list is a placeholder: every item is a page that
 * already exists, which is what makes the menu trustworthy enough to grow into.
 */
const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Market',
    items: [
      { label: 'Dashboard', to: '/', icon: <SpaceDashboardRoundedIcon fontSize="small" /> },
      { label: 'Movers', to: '/movers', icon: <TrendingUpRoundedIcon fontSize="small" /> },
      { label: 'Screener', to: '/screener', icon: <FilterAltRoundedIcon fontSize="small" /> },
      { label: 'Sectors', to: '/sectors', icon: <PieChartRoundedIcon fontSize="small" /> },
      { label: 'Dividends', to: '/dividends', icon: <PaymentsRoundedIcon fontSize="small" /> },
      { label: 'Announcements', to: '/announcements', icon: <CampaignRoundedIcon fontSize="small" /> },
    ],
  },
  {
    title: 'Your tools',
    items: [
      { label: 'Watchlist', to: '/watchlist', icon: <StarRoundedIcon fontSize="small" /> },
      { label: 'Alerts', to: '/alerts', icon: <NotificationsActiveRoundedIcon fontSize="small" /> },
      { label: 'Compare', to: '/compare', icon: <CompareArrowsRoundedIcon fontSize="small" /> },
    ],
  },
  ...(isDev
    ? [
        {
          title: 'Developer',
          items: [{ label: 'Sync Logs', to: '/logs', icon: <ReceiptLongRoundedIcon fontSize="small" /> }],
        },
      ]
    : []),
  {
    title: 'Portfolio',
    items: [{ label: 'Portfolio Manager', link: PORTFOLIO_LINK, icon: <OpenInNewRoundedIcon fontSize="small" /> }],
  },
];

/**
 * The corner menu: a drawer holding every destination, and the place new features are added.
 *
 * Kept separate from the header's inline nav on purpose. The nav is a reading order for the four or
 * five pages someone checks daily; this is the index. On a phone it is the only place the full list
 * exists, and on a desktop it is where a destination that does not deserve a pill goes.
 */
export function AppMenu() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // `/` is only itself; every other path is active for its own prefix, so a stock page keeps
  // "Screener" unlit and a sector drill-down keeps "Sectors" lit.
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  return (
    <>
      <IconButton
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-haspopup="dialog"
        sx={{
          color: 'nav.text',
          borderRadius: 2,
          // Sits hard against the bar's left edge, before the brand: the corner is the one place a
          // reader's eye goes for "everything else", and nothing else lives there.
          ml: { xs: -0.75, md: -0.5 },
          flexShrink: 0,
        }}
      >
        <FriesMenuIcon />
      </IconButton>

      <Drawer
        anchor="left"
        open={open}
        onClose={() => setOpen(false)}
        ModalProps={{ keepMounted: false }}
        PaperProps={{
          sx: {
            width: 300,
            maxWidth: '86vw',
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.5 }}>
          <Box component="img" src="/logo-64.png" alt="" aria-hidden sx={{ width: 28, height: 28, display: 'block' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>MyPortfolio365</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.08em', fontWeight: 600 }}>
              MARKET
            </Typography>
          </Box>
          <IconButton onClick={() => setOpen(false)} aria-label="Close menu" edge="end">
            <CloseRoundedIcon />
          </IconButton>
        </Box>
        <Divider />

        <Box component="nav" aria-label="Menu" sx={{ flex: 1, overflowY: 'auto', py: 1 }}>
          {SECTIONS.map((section) => (
            <Box key={section.title} sx={{ '& + &': { mt: 1 } }}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: 'block', px: 2, pt: 1, pb: 0.5, lineHeight: 1.6, letterSpacing: '0.1em' }}
              >
                {section.title}
              </Typography>
              <List dense disablePadding>
                {section.items.map((item) => {
                  const active = item.to ? isActive(item.to) : false;
                  return (
                    <ListItemButton
                      key={item.label}
                      {...(item.link
                        ? item.link
                        : { component: RouterLink, to: item.to, onClick: () => setOpen(false) })}
                      aria-current={active ? 'page' : undefined}
                      sx={{
                        mx: 1,
                        borderRadius: 2,
                        minHeight: 44,
                        ...(active ? { bgcolor: 'action.selected', color: 'primary.main' } : {}),
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>{item.icon}</ListItemIcon>
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{ sx: { fontSize: '0.9375rem', fontWeight: active ? 700 : 500 } }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          ))}
        </Box>
      </Drawer>
    </>
  );
}
