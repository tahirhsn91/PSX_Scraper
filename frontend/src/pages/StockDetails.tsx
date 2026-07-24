import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Typography, Button, Grid, Card, CardContent, Tabs, Tab, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, LinearProgress, Alert, Skeleton, Stack, Divider,
  ToggleButton, ToggleButtonGroup, useMediaQuery, useTheme,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import DownloadIcon from '@mui/icons-material/Download';
import { LineChart } from '@mui/x-charts/LineChart';
import { useQueryClient } from '@tanstack/react-query';
import {
  useStock, useHistory, useSyncStock, useSyncStatus, useFetchHistory, useHistoryStatus, keys,
} from '../api/hooks';
import type { HistoryRange } from '../types';

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '1Y', label: '1Y' },
  { value: '2Y', label: '2Y' },
  { value: '3Y', label: '3Y' },
  { value: '5Y', label: '5Y' },
  { value: 'MAX', label: 'Max' },
];

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Grid item xs={6} sm={4} md={3}>
      <Card variant="outlined"><CardContent sx={{ py: 1.5 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h6">{value ?? '—'}</Typography>
      </CardContent></Card>
    </Grid>
  );
}

export function StockDetails() {
  const { symbol = '' } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const qc = useQueryClient();
  const { data, isLoading, isError } = useStock(symbol);
  const [range, setRange] = useState<HistoryRange>('1Y');
  const { data: history, isFetching: historyLoading } = useHistory(symbol, range);
  const syncStock = useSyncStock();
  const { data: status } = useSyncStatus(syncStock.isPending);
  const [tab, setTab] = useState(0);

  // Historical fetch job + live progress
  const fetchHistory = useFetchHistory(symbol);
  const [fetching, setFetching] = useState(false);
  const { data: histJob } = useHistoryStatus(symbol, fetching);

  const progressPct = (() => {
    const p = histJob?.progress;
    if (p && typeof p === 'object' && typeof p.percent === 'number') return p.percent;
    return null;
  })();

  useEffect(() => {
    if (!fetching || !histJob) return;
    if (histJob.state === 'completed' || histJob.state === 'failed') {
      setFetching(false);
      qc.invalidateQueries({ queryKey: keys.history(symbol, range) });
      qc.invalidateQueries({ queryKey: keys.stock(symbol) });
    }
  }, [histJob, fetching, qc, symbol, range]);

  const startFetch = () => {
    setFetching(true);
    fetchHistory.mutate(range, { onError: () => setFetching(false) });
  };

  const syncing = syncStock.isPending || (status?.inFlight ?? []).includes(symbol.toUpperCase());

  if (isLoading) return <Box><Skeleton height={60} /><Skeleton height={240} /></Box>;
  if (isError || !data) return <Alert severity="error">Could not load {symbol}. It may not be tracked yet.</Alert>;

  const chart = (history?.items ?? [])
    .filter((p) => p.close != null && p.lastTradeDate)
    .slice()
    .reverse();

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={2}>
        <Box>
          <Typography variant="h4">{data.symbol}</Typography>
          <Typography color="text.secondary">{data.companyName ?? '—'}{data.sector ? ` · ${data.sector}` : ''}</Typography>
        </Box>
        <Stack alignItems="flex-end" spacing={1}>
          <Button variant="contained" startIcon={<SyncIcon />} disabled={syncing} onClick={() => syncStock.mutate(symbol)}>
            {syncing ? 'Syncing…' : 'Sync Latest Data'}
          </Button>
          {data.lastSync && (
            <Chip size="small" label={`Last sync: ${data.lastSync.status}`} color={data.lastSync.status === 'SUCCESS' ? 'success' : data.lastSync.status === 'FAILED' ? 'error' : 'warning'} />
          )}
        </Stack>
      </Stack>
      {syncing && <LinearProgress sx={{ mb: 2 }} />}

      <Grid container spacing={2} mb={3}>
        <Stat label="Price" value={data.price?.currentPrice} />
        <Stat label="Change %" value={data.price?.changePercent != null ? `${data.price.changePercent}%` : null} />
        <Stat label="Open" value={data.price?.open} />
        <Stat label="High" value={data.price?.high} />
        <Stat label="Low" value={data.price?.low} />
        <Stat label="Volume" value={data.price?.volume} />
        <Stat label="Market Cap" value={data.price?.marketCap} />
        <Stat label="Last trade" value={data.price?.lastTradeDate ? new Date(data.price.lastTradeDate).toLocaleDateString() : null} />
      </Grid>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable">
        <Tab label="History" /><Tab label="Financials" /><Tab label="Ratios" /><Tab label="Dividends" />
      </Tabs>

      {tab === 0 && (
        <Box>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ md: 'center' }}
            mb={2}
          >
            <ToggleButtonGroup
              size="small"
              exclusive
              value={range}
              onChange={(_e, v) => v && setRange(v)}
              aria-label="history range"
            >
              {RANGES.map((r) => (
                <ToggleButton key={r.value} value={r.value}>{r.label}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              disabled={fetching}
              onClick={startFetch}
            >
              {fetching ? 'Fetching…' : 'Fetch Historical Data'}
            </Button>
          </Stack>

          {fetching && (
            <Box mb={2}>
              <LinearProgress
                variant={progressPct != null ? 'determinate' : 'indeterminate'}
                value={progressPct ?? undefined}
              />
              <Typography variant="caption" color="text.secondary">
                {progressPct != null ? `${progressPct}% ` : ''}
                {(histJob?.progress && typeof histJob.progress === 'object' && histJob.progress.note) || 'starting…'}
              </Typography>
            </Box>
          )}
          {fetchHistory.isError && <Alert severity="error" sx={{ mb: 2 }}>Failed to start history fetch.</Alert>}
          {histJob?.state === 'failed' && !fetching && (
            <Alert severity="error" sx={{ mb: 2 }}>History fetch failed: {histJob.failedReason ?? 'unknown error'}</Alert>
          )}
          {!fetching && histJob?.state === 'completed' && histJob.returnValue && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Fetched {histJob.returnValue.persisted ?? 0} data points for {RANGES.find((r) => r.value === range)?.label}.
            </Alert>
          )}

          {historyLoading ? (
            <Skeleton height={320} />
          ) : chart.length > 1 ? (
            <LineChart
              height={isMobile ? 240 : 340}
              xAxis={[{
                scaleType: 'point',
                data: chart.map((p) => new Date(p.lastTradeDate!).toLocaleDateString()),
                tickLabelStyle: { fontSize: 10 },
              }]}
              series={[{ data: chart.map((p) => p.close as number), label: 'Close', color: '#0b8457', showMark: false }]}
            />
          ) : (
            <Alert severity="info">
              No price history for this range yet. Click <strong>Fetch Historical Data</strong> to pull it from PSX.
            </Alert>
          )}
        </Box>
      )}

      {tab === 1 && (
        <Table size="small">
          <TableHead><TableRow><TableCell>Year</TableCell><TableCell>Qtr</TableCell><TableCell align="right">EPS</TableCell><TableCell align="right">Sales</TableCell><TableCell align="right">PAT</TableCell><TableCell align="right">Equity</TableCell></TableRow></TableHead>
          <TableBody>
            {data.financials.length === 0 && <TableRow><TableCell colSpan={6}>No financials recorded.</TableCell></TableRow>}
            {data.financials.map((f, i) => (
              <TableRow key={i}><TableCell>{f.year}</TableCell><TableCell>{f.quarter ?? '—'}</TableCell><TableCell align="right">{f.eps ?? '—'}</TableCell><TableCell align="right">{f.sales ?? '—'}</TableCell><TableCell align="right">{f.profitAfterTax ?? '—'}</TableCell><TableCell align="right">{f.equity ?? '—'}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {tab === 2 && (
        data.ratios ? (
          <Grid container spacing={2}>
            <Stat label="P/E" value={data.ratios.peRatio} />
            <Stat label="P/B" value={data.ratios.pbRatio} />
            <Stat label="ROE" value={data.ratios.roe} />
            <Stat label="ROA" value={data.ratios.roa} />
            <Stat label="Div. Yield" value={data.ratios.dividendYield} />
            <Stat label="Beta" value={data.ratios.beta} />
          </Grid>
        ) : <Alert severity="info">No ratios recorded.</Alert>
      )}

      {tab === 3 && (
        <Table size="small">
          <TableHead><TableRow><TableCell>Announced</TableCell><TableCell>Book closure</TableCell><TableCell>Payment</TableCell><TableCell align="right">Dividend</TableCell></TableRow></TableHead>
          <TableBody>
            {data.dividends.length === 0 && <TableRow><TableCell colSpan={4}>No dividends recorded.</TableCell></TableRow>}
            {data.dividends.map((d, i) => (
              <TableRow key={i}>
                <TableCell>{d.announcementDate ? new Date(d.announcementDate).toLocaleDateString() : '—'}</TableCell>
                <TableCell>{d.bookClosure ? new Date(d.bookClosure).toLocaleDateString() : '—'}</TableCell>
                <TableCell>{d.paymentDate ? new Date(d.paymentDate).toLocaleDateString() : '—'}</TableCell>
                <TableCell align="right">{d.dividend ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Divider sx={{ mt: 4 }} />
    </Box>
  );
}
