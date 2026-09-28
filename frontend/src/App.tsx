import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box, Grid, Skeleton } from '@mui/material';
import { Layout } from './components/Layout';

// One bundle used to carry every page, its charts and the TradingView widget loader before the
// market board could paint. Each page is now its own chunk, fetched when its route is opened;
// the shell and the primitives stay eager because the header renders on every route.
const Dashboard = lazy(() =>
  import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })),
);
const SearchResults = lazy(() =>
  import('./pages/SearchResults').then((m) => ({ default: m.SearchResults })),
);
const StockDetails = lazy(() =>
  import('./pages/StockDetails').then((m) => ({ default: m.StockDetails })),
);
const IndexDetail = lazy(() =>
  import('./pages/IndexDetail').then((m) => ({ default: m.IndexDetail })),
);
const SyncLogs = lazy(() => import('./pages/SyncLogs').then((m) => ({ default: m.SyncLogs })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));

/** Mirrors the page shape so the swap does not jump: a title, a KPI row, a chart card. */
function RouteFallback() {
  return (
    <Box aria-busy="true">
      <Skeleton variant="text" width="30%" height={44} />
      <Skeleton variant="text" width="55%" height={22} sx={{ mb: 2 }} />
      <Grid container spacing={1.5}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Grid item xs={6} md={3} key={i}>
            <Skeleton variant="rounded" height={92} />
          </Grid>
        ))}
      </Grid>
      <Skeleton variant="rounded" height={320} sx={{ mt: 2 }} />
    </Box>
  );
}

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/stocks/:symbol" element={<StockDetails />} />
          <Route path="/indices/:symbol" element={<IndexDetail />} />
          <Route path="/logs" element={<SyncLogs />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
