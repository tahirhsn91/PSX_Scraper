import { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import { StatusPage } from './ui/StatusPage';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A lazy route that cannot be fetched — the usual cause is a tab that was open when a new version
 * was deployed, so the chunk it is asking for no longer exists under that hash.
 */
function isChunkLoadError(error: Error): boolean {
  const text = `${error.name} ${error.message}`;
  return (
    /ChunkLoadError|Loading chunk|Importing a module script failed/i.test(text) ||
    error.name === 'ChunkLoadError'
  );
}

/**
 * Top-level guard: a render error used to leave a blank page with the message only in the console.
 *
 * Two things this deliberately does *not* do. It does not print `error.message` on the page — that
 * string is written for whoever wrote the code, and a minified production message is meaningless to
 * a reader while still exposing internals; it goes in the collapsed detail instead. And it does not
 * rely on the router: the boundary sits above `BrowserRouter`, so every link here is a plain anchor
 * and every action is a real navigation.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as a console error on purpose: there is no error-reporting backend in this app.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkLoadError(error);
    const detail = [error.message, error.stack].filter(Boolean).join('\n\n');

    return (
      <StatusPage
        standalone
        code={
          stale ? (
            <CloudOffRoundedIcon fontSize="inherit" aria-hidden />
          ) : (
            <ReportProblemRoundedIcon fontSize="inherit" aria-hidden />
          )
        }
        title={stale ? 'A new version is available' : 'The app hit an unexpected error'}
        description={
          stale
            ? 'This tab was open when the app was updated, so part of it is out of date. Reloading loads the current version.'
            : 'Something went wrong while drawing this page. Reloading usually clears it — your watchlist and portfolio are stored separately, so they are not affected.'
        }
        actions={
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            useFlexGap
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            <Button variant="contained" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
            {/* A real anchor, not a router link: there is no router above this boundary and the
                page it is on may be the thing that failed to render. */}
            <Button variant="outlined" href="/">
              Go to the dashboard
            </Button>
          </Stack>
        }
        detail={
          <Box
            component="details"
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.paper',
              px: 2,
              py: 1.25,
              // A native disclosure, so it needs no JavaScript to open: on the surface that exists
              // because JavaScript threw, that matters.
              '& summary': { cursor: 'pointer', color: 'text.secondary' },
            }}
          >
            <Typography component="summary" variant="body2">
              Technical details
            </Typography>
            <Box
              component="pre"
              sx={{
                mt: 1.5,
                mb: 0.5,
                p: 1.5,
                maxHeight: 240,
                overflow: 'auto',
                borderRadius: 1,
                bgcolor: 'sunken',
                color: 'text.secondary',
                fontSize: '0.75rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {detail || 'No detail was recorded for this error.'}
            </Box>
          </Box>
        }
      />
    );
  }
}
