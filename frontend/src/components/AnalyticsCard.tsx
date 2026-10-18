import { Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { DASH } from '../lib/format';
import { StatePanel } from './ui/StatePanel';

interface Summary {
  days: number;
  total: number;
  byName: Array<{ name: string; count: number }>;
  search: { submitted: number; withResults: number; successRate: number | null };
  screens: { applied: number };
  comparisons: number;
  sync: { total: number; succeeded: number; successRate: number | null };
  collectionEnabled: boolean;
  retentionDays: number;
}

const pct = (v: number | null) => (v === null ? DASH : `${(v * 100).toFixed(1)}%`);

/** Search success and sync success, plus the event counts behind them (#212). */
export function AnalyticsCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'summary', 7],
    queryFn: async () => (await api.get<Summary>('/analytics/summary', { params: { days: 7 } })).data,
    staleTime: 60_000,
  });

  if (isLoading) return <StatePanel kind="loading" title="Loading analytics" />;
  if (isError || !data) return <StatePanel kind="error" title="Analytics could not be loaded" />;

  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="h6">Product analytics</Typography>
        <Chip size="small" variant="outlined" label={`last ${data.days} days`} />
        <Chip
          size="small"
          variant="outlined"
          color={data.collectionEnabled ? 'success' : 'default'}
          label={data.collectionEnabled ? 'collecting' : 'collection disabled'}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        First-party only: no IP, user agent, cookie or identifier is stored, and searches are counted
        by outcome — the query text is never recorded. Retained {data.retentionDays} days.
      </Typography>

      <Table size="small" aria-label="Analytics summary">
        <TableHead>
          <TableRow>
            <TableCell>Measure</TableCell>
            <TableCell align="right">Value</TableCell>
            <TableCell>How it is computed</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Search success rate</TableCell>
            <TableCell align="right">{pct(data.search.successRate)}</TableCell>
            <TableCell>
              {data.search.withResults} of {data.search.submitted} submitted searches returned a result
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Sync success rate</TableCell>
            <TableCell align="right">{pct(data.sync.successRate)}</TableCell>
            <TableCell>
              {data.sync.succeeded} of {data.sync.total} sync attempts (SUCCESS or PARTIAL)
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Screener applications</TableCell>
            <TableCell align="right">{data.screens.applied}</TableCell>
            <TableCell>filter applied events</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Comparisons created</TableCell>
            <TableCell align="right">{data.comparisons}</TableCell>
            <TableCell>compare created events</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Events recorded</TableCell>
            <TableCell align="right">{data.total}</TableCell>
            <TableCell>{data.byName.slice(0, 3).map((e) => `${e.name} ${e.count}`).join(' · ') || DASH}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Box>
  );
}
