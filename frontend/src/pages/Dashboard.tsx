import { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  TablePagination, TableSortLabel,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip, Skeleton, Alert,
  Stack, Grid, Card, CardContent, LinearProgress, Snackbar,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import SyncIcon from '@mui/icons-material/Sync';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import { useStocks, useAddStock, useSyncStatus, useSyncAll, useIndices } from '../api/hooks';
import { IndicesPanel } from '../components/IndicesPanel';
import { SearchBar } from '../components/SearchBar';
import type { ApiError } from '../api/client';
import type { StockSortField, SortOrder } from '../types';

/**
 * The pair of arrows on a sortable column: down for ascending, up for descending.
 *
 * Both are always drawn, so a column reads as sortable before it has been touched — MUI's own
 * label hides the icon until hover, and on a phone there is no hover. The active direction is
 * the solid arrow, the other stays faint. Tapping the header toggles between the two.
 */
function SortArrows({ active, direction }: { active?: boolean; direction?: 'asc' | 'desc' }) {
  const faint = 0.3;
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 0, ml: 0.5, verticalAlign: 'middle' }}
    >
      <ArrowUpwardRounded sx={{ fontSize: 11, opacity: active && direction === 'desc' ? 1 : faint }} />
      <ArrowDownwardRounded sx={{ fontSize: 11, mt: '-2px', opacity: active && direction === 'asc' ? 1 : faint }} />
    </Box>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addStock = useAddStock();
  const syncAll = useSyncAll();
  const [open, setOpen] = useState(false);
  const [confirmSyncAll, setConfirmSyncAll] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [justTriggered, setJustTriggered] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // The universe worker (#41) puts every listed security on this dashboard, so the table is
  // paged rather than cut off at the first N symbols.
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  // Sorting is done by the API, not here: the table shows 50 of ~500 symbols, so ordering in
  // the browser would only shuffle the page you happen to be looking at.
  const [sort, setSort] = useState<StockSortField | undefined>(undefined);
  const [order, setOrder] = useState<SortOrder>('asc');

  /** Another column starts ascending; the same one flips. The page resets with the order —
   *  page 4 of "volume descending" means nothing once the order changes. */
  const handleSort = (field: StockSortField) => {
    if (sort === field) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setOrder('asc');
    }
    setPage(0);
  };

  /** A sortable numeric header. */
  const sortableHeader = (label: string, field: StockSortField) => (
    <TableCell align="right" sortDirection={sort === field ? order : false}>
      <TableSortLabel
        active={sort === field}
        direction={order}
        onClick={() => handleSort(field)}
        // Deliberately not forwarding MUI's icon className: that class fades the icon out on
        // unsorted columns and rotates it for the direction, and both would fight the two-arrow
        // affordance. The arrows are drawn entirely from this component's own state (which
        // column is sorted, and which way), so nothing depends on MUI's internal icon props.
        IconComponent={() => <SortArrows active={sort === field} direction={order} />}
        // "52W Low" / "52W High" would otherwise break onto two lines and drop their arrows
        // out of line with the rest of the header.
        sx={{ whiteSpace: 'nowrap' }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  // Poll queue status continuously; also while a "sync all" just fired so the
  // active/waiting counts (and the progress bar) reflect the fan-out in real time.
  const { data: status } = useSyncStatus(true);
  const syncCounts = status?.queues['stock-sync'];
  const inFlightCount = syncCounts?.active ?? 0;
  const queuedCount = syncCounts?.waiting ?? 0;
  const syncingAll = justTriggered || inFlightCount > 0 || queuedCount > 0;

  // Keep the stock table itself fresh (prices, last-synced) while a sync is running.
  const { data, isLoading, isError } = useStocks(page + 1, rowsPerPage, syncingAll, sort, order);
  // The index board is scraped separately from the stocks: it comes from the exchange's own
  // market-summary page, and it is a handful of rows rather than a paginated list.
  const { data: indexBoard } = useIndices(syncingAll);

  // Once the fan-out has actually started showing up in the queue, stop forcing
  // the "just triggered" state — the real counts take over.
  useEffect(() => {
    if (justTriggered && (inFlightCount > 0 || queuedCount > 0)) {
      setJustTriggered(false);
    }
  }, [justTriggered, inFlightCount, queuedCount]);

  // When syncing finishes (active + waiting both drop to 0), do one final refresh
  // so the table's prices / last-synced values are guaranteed current, then notify.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !syncingAll) {
      qc.invalidateQueries({ queryKey: ['stocks'] });
      setToast('Sync complete — all stocks are up to date.');
    }
    wasSyncing.current = syncingAll;
  }, [syncingAll, qc]);

  const submit = () => {
    const s = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(s)) return;
    addStock.mutate(s, { onSuccess: () => { setOpen(false); setSymbol(''); } });
  };

  const runSyncAll = () => {
    setConfirmSyncAll(false);
    syncAll.mutate(undefined, {
      onSuccess: () => {
        setJustTriggered(true);
        setToast('Sync started for all tracked stocks.');
      },
      onError: () => setToast('Failed to start sync — please try again.'),
    });
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={2}>
        <Typography variant="h4">Dashboard Scrapper</Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<SyncIcon />}
            disabled={syncingAll || syncAll.isPending}
            onClick={() => setConfirmSyncAll(true)}
          >
            {syncingAll ? 'Syncing All…' : 'Sync All'}
          </Button>
          <Button variant="contained" onClick={() => setOpen(true)}>Add Stock</Button>
        </Stack>
      </Stack>

      <Box mb={3}><SearchBar /></Box>

      <Grid container spacing={2} mb={1}>
        {[
          { label: 'Tracked stocks', value: data?.total ?? '—' },
          { label: 'Active syncs', value: syncCounts?.active ?? 0 },
          { label: 'Waiting', value: syncCounts?.waiting ?? 0 },
          { label: 'Failed', value: syncCounts?.failed ?? 0 },
        ].map((c) => (
          <Grid item xs={6} md={3} key={c.label}>
            <Card variant="outlined"><CardContent>
              <Typography variant="body2" color="text.secondary">{c.label}</Typography>
              <Typography variant="h5">{c.value}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      {syncingAll && (
        <Box mb={2}>
          <LinearProgress />
          <Typography variant="caption" color="text.secondary">
            Syncing all tracked stocks — {inFlightCount} active, {queuedCount} waiting. This page updates automatically.
          </Typography>
        </Box>
      )}

      {isError && <Alert severity="error">Failed to load stocks.</Alert>}

      <IndicesPanel indices={indexBoard?.items} />

      <Paper variant="outlined">
        {/* Eight columns do not fit a phone. TableContainer gives the table its own horizontal
            scroll area; without one the table pushed the *page* sideways — at a 384px viewport
            the document measured 835px (a 451px overflow), so every row ran off the screen. */}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                {/* Company and "Last synced" are the two columns a phone cannot afford: the
                    widest, the least load-bearing, and one tap away on the detail page. The
                    numbers are what a mobile dashboard is for, so they stay at every width. */}
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Company</TableCell>
                {sortableHeader('Price', 'price')}
                {sortableHeader('52W Low', 'week52Low')}
                {sortableHeader('52W High', 'week52High')}
                {sortableHeader('Change %', 'changePercent')}
                {sortableHeader('Volume', 'volume')}
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Last synced</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={8}><Skeleton /></TableCell></TableRow>
                ))}
              {data?.items.length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={8} align="center">No stocks yet — add one to get started.</TableCell></TableRow>
              )}
              {data?.items.map((s) => (
                <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/stocks/${s.symbol}`)}>
                  <TableCell><strong>{s.symbol}</strong></TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{s.companyName ?? '—'}</TableCell>
                  <TableCell align="right">{s.currentPrice ?? '—'}</TableCell>
                  {/* Null means "the page had no 52-week block", so it reads as a dash rather
                      than a zero — the API never substitutes a value here. */}
                  <TableCell align="right">{s.week52Low ?? '—'}</TableCell>
                  <TableCell align="right">{s.week52High ?? '—'}</TableCell>
                  <TableCell align="right">
                    {s.changePercent != null ? (
                      <Chip size="small" color={s.changePercent >= 0 ? 'success' : 'error'} label={`${s.changePercent.toFixed(2)}%`} />
                    ) : '—'}
                  </TableCell>
                  {/* Thousands separators: session volumes run to seven figures. */}
                  <TableCell align="right">{s.volume != null ? s.volume.toLocaleString() : '—'}</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : 'never'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100, 250]}
        />
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add Stock</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth margin="dense" label="PSX Symbol" placeholder="FFC"
            value={symbol} onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {addStock.isError && <Alert severity="error" sx={{ mt: 1 }}>{(addStock.error as unknown as ApiError)?.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={addStock.isPending}>Add & Scrape</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmSyncAll} onClose={() => setConfirmSyncAll(false)} fullWidth maxWidth="xs">
        <DialogTitle>Sync all stocks?</DialogTitle>
        <DialogContent>
          <Typography>
            This fetches the latest data for all {data?.total ?? 0} tracked stock{data?.total === 1 ? '' : 's'} from PSX
            and Sarmaaya. It runs in the background — you can keep using the dashboard while it completes.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSyncAll(false)}>Cancel</Button>
          <Button variant="contained" onClick={runSyncAll} disabled={syncAll.isPending}>
            Sync All
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
