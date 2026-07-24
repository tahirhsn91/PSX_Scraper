import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ColorModeProvider } from './ColorModeContext';

export function AppProviders({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <ColorModeProvider>
        <BrowserRouter>{children}</BrowserRouter>
      </ColorModeProvider>
    </QueryClientProvider>
  );
}
