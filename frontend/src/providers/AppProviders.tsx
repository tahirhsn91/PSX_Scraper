import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ColorModeProvider } from './ColorModeContext';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ErrorBoundary } from '../components/ErrorBoundary';

export function AppProviders({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      {/* Order matters: the theme must exist before the boundary or the toast can render anything. */}
      <ColorModeProvider>
        <ErrorBoundary>
          <ToastProvider>
            <BrowserRouter>{children}</BrowserRouter>
          </ToastProvider>
        </ErrorBoundary>
      </ColorModeProvider>
    </QueryClientProvider>
  );
}
