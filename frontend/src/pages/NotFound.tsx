import { Button, Stack } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import ListAltRoundedIcon from '@mui/icons-material/ListAltRounded';
import { Link as RouterLink } from 'react-router-dom';
import { StatusPage } from '../components/ui/StatusPage';
import { useGoBack } from '../lib/useGoBack';

/**
 * Unknown route.
 *
 * Renders inside `Layout`, so the header, its navigation and the global search are all still
 * available — the reader is never stranded. The point of the page is to say plainly that the URL
 * does not match anything, then offer the two routes that actually resolve: back to the board, or
 * into the full tracked list.
 */
export function NotFound() {
  const goBack = useGoBack();

  return (
    <StatusPage
      code="404"
      title="We could not find that page"
      description="The link may be out of date, or that symbol is not tracked yet. The search box in the header finds any stock we follow."
      actions={
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          useFlexGap
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          <Button
            component={RouterLink}
            to="/"
            variant="contained"
            startIcon={<HomeRoundedIcon />}
          >
            Back to dashboard
          </Button>
          <Button
            component={RouterLink}
            to="/screener"
            variant="outlined"
            startIcon={<ListAltRoundedIcon />}
          >
            Browse all stocks
          </Button>
          {/* Only offered when there is somewhere to go back to: landing here as the first page of
              a session would otherwise show a dead control. */}
          {goBack.canGoBack && (
            <Button variant="text" onClick={goBack.goBack}>
              Go back
            </Button>
          )}
        </Stack>
      }
    />
  );
}
