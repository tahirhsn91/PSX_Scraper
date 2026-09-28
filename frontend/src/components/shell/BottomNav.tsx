import { Box, ButtonBase, Typography } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { layout } from '../../theme/tokens';

const ITEMS = [
  { label: 'Dashboard', to: '/', icon: <HomeRoundedIcon /> },
  { label: 'Sync Logs', to: '/logs', icon: <SyncRoundedIcon /> },
];

/**
 * Mobile navigation. Two destinations plus search is all the app has, so a bottom bar keeps the
 * thumb-reachable pattern without a drawer; the desktop header carries the same links.
 */
export function BottomNav({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { pathname } = useLocation();

  return (
    <Box
      component="nav"
      aria-label="Primary"
      sx={{
        position: 'fixed',
        insetInline: 0,
        bottom: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        display: { xs: 'flex', md: 'none' },
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      {ITEMS.map((item) => {
        const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
        return (
          <NavButton
            key={item.to}
            label={item.label}
            icon={item.icon}
            active={active}
            to={item.to}
          />
        );
      })}
      <NavButton label="Search" icon={<SearchRoundedIcon />} onClick={onOpenSearch} />
    </Box>
  );
}

interface NavButtonProps {
  label: string;
  icon: JSX.Element;
  active?: boolean;
  /** Renders a real link when present, so the item is a link for assistive tech and middle-click. */
  to?: string;
  onClick?: () => void;
}

function NavButton({ label, icon, active = false, to, onClick }: NavButtonProps) {
  const sx = {
    flex: 1,
    minHeight: layout.bottomNavHeight,
    display: 'flex',
    flexDirection: 'column',
    gap: 0.25,
    py: 1,
    color: active ? 'primary.main' : 'text.secondary',
    transition: (theme: import('@mui/material').Theme) =>
      `color ${theme.app.motion.fast} ${theme.app.motion.easing}`,
  };

  if (to) {
    return (
      <ButtonBase component={RouterLink} to={to} aria-current={active ? 'page' : undefined} sx={sx}>
        <NavButtonBody label={label} icon={icon} />
      </ButtonBase>
    );
  }

  return (
    <ButtonBase onClick={onClick} sx={sx}>
      <NavButtonBody label={label} icon={icon} />
    </ButtonBase>
  );
}

function NavButtonBody({ label, icon }: { label: string; icon: JSX.Element }) {
  return (
    <>
      <Box sx={{ display: 'flex', fontSize: 22, '& svg': { fontSize: 'inherit' } }} aria-hidden>
        {icon}
      </Box>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
    </>
  );
}
