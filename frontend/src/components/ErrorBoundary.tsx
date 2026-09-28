import { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Button } from '@mui/material';
import { StatePanel } from './ui/StatePanel';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level guard: a render error used to leave a blank page with the message only in the console.
 * Now the user gets a real state with a way out, and the detail stays available for a report.
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

    return (
      <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 8 }}>
        <StatePanel
          kind="error"
          title="The app hit an unexpected error"
          description={error.message}
          action={
            <Button variant="contained" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
          }
        />
      </Box>
    );
  }
}
