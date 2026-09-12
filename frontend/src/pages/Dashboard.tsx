import { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, Chip, Skeleton, Alert, Stack, Grid, Card,
  CardContent, LinearProgress, Snackbar,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import SyncIcon from '@mui/icons-material/Sync';
import { useStocks, useAddStock, useSyncStatus, useSyncAll } from '../api/hooks';
import { SearchBar } from '../components/SearchBar';
import type { ApiError } from '../api/client';

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

  // Poll queue status continuously; also while a "sync all" just fired so the
  // active/waiting counts (and the progress bar) reflect the fan-out in real time.
  const { data: status } = useSyncStatus(true);
  const syncCounts = status?.queues['stock-sync'];
  const inFlightCount = syncCounts?.active ?? 0;
  const queuedCount = syncCounts?.waiting ?? 0;
  const syncingAll = justTriggered || inFlightCount > 0 || queuedCount > 0;

  // Keep the stock table itself fresh (prices, last-synced) while a sync is running.
  const { data, isLoading, isError } = useStocks(1, 50, syncingAll);

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

      <Paper variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Symbol</TableCell>
              <TableCell>Company</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell align="right">Change %</TableCell>
              <TableCell>Last synced</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton /></TableCell></TableRow>
              ))}
            {data?.items.length === 0 && !isLoading && (
              <TableRow><TableCell colSpan={5} align="center">No stocks yet — add one to get started.</TableCell></TableRow>
            )}
            {data?.items.map((s) => (
              <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/stocks/${s.symbol}`)}>
                <TableCell><strong>{s.symbol}</strong></TableCell>
                <TableCell>{s.companyName ?? '—'}</TableCell>
                <TableCell align="right">{s.currentPrice ?? '—'}</TableCell>
                <TableCell align="right">
                  {s.changePercent != null ? (
                    <Chip size="small" color={s.changePercent >= 0 ? 'success' : 'error'} label={`${s.changePercent.toFixed(2)}%`} />
                  ) : '—'}
                </TableCell>
                <TableCell>{s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : 'never'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
