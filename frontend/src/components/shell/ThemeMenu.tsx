import { useState } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import BrightnessAutoRoundedIcon from '@mui/icons-material/BrightnessAutoRounded';
import { useColorMode, type ThemePreference } from '../../providers/ColorModeContext';

const OPTIONS: { value: ThemePreference; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: 'Light', icon: <LightModeRoundedIcon fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkModeRoundedIcon fontSize="small" /> },
  { value: 'system', label: 'Match system', icon: <BrightnessAutoRoundedIcon fontSize="small" /> },
];

/**
 * Theme control: one button showing the current mode, opening a three-way menu (light / dark /
 * match system). The preference is persisted under the same `color-mode` key the app always used.
 */
export function ThemeMenu() {
  const { mode, preference, setPreference } = useColorMode();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  return (
    <>
      <Tooltip title={`Theme: ${preference === 'system' ? 'match system' : preference}`}>
        <IconButton
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label="Theme"
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
        >
          {mode === 'dark' ? <DarkModeRoundedIcon /> : <LightModeRoundedIcon />}
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {OPTIONS.map((o) => (
          <MenuItem
            key={o.value}
            selected={preference === o.value}
            onClick={() => {
              setPreference(o.value);
              setAnchor(null);
            }}
          >
            <ListItemIcon>{o.icon}</ListItemIcon>
            <ListItemText>{o.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
