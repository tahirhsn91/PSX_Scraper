import { ReactNode } from 'react';
import { AppBar, Toolbar, Typography, IconButton, Box, Container, Button } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { useColorMode } from '../providers/ColorModeContext';

const NAV = [
  { label: 'Dashboard', to: '/' },
  { label: 'Sync Logs', to: '/logs' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { mode, toggle } = useColorMode();
  const loc = useLocation();
  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="sticky">
        <Toolbar>
          <Typography variant="h6" component={RouterLink} to="/" sx={{ flexGrow: 0, mr: 3, color: 'inherit', textDecoration: 'none' }}>
            PSX Scraper
          </Typography>
          <Box sx={{ flexGrow: 1, display: 'flex', gap: 1 }}>
            {NAV.map((n) => (
              <Button key={n.to} component={RouterLink} to={n.to} color="inherit" variant={loc.pathname === n.to ? 'outlined' : 'text'}>
                {n.label}
              </Button>
            ))}
          </Box>
          <IconButton color="inherit" onClick={toggle} aria-label="toggle theme">
            {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        {children}
      </Container>
    </Box>
  );
}
