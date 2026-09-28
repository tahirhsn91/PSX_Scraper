import { AppBar, Box, Button, Dialog, IconButton, Stack, Toolbar, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useNavigate } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';

/**
 * Phone search surface: a full-screen sheet so the keyboard does not fight a cramped header, with
 * a direct route to the full results page for queries that are not an exact symbol.
 */
export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onClose={onClose} fullScreen sx={{ display: { md: 'none' } }} aria-label="Search stocks">
      <AppBar position="static" component="div">
        <Toolbar sx={{ gap: 1 }}>
          <Stack direction="row" alignItems="center" sx={{ flex: 1, gap: 1 }}>
            <GlobalSearch autoFocus size="small" onNavigate={onClose} placeholder="Search stocks" />
          </Stack>
          <IconButton onClick={onClose} aria-label="Close search">
            <CloseRoundedIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Tip: pick a suggestion to open the stock, or press Enter to see every match.
        </Typography>
        <Button
          variant="outlined"
          fullWidth
          onClick={() => {
            onClose();
            navigate('/');
          }}
        >
          Back to dashboard
        </Button>
      </Box>
    </Dialog>
  );
}
