import { useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, TextField, Skeleton, Alert,
} from '@mui/material';
import { useSyncLogs, useSyncAll } from '../api/hooks';

const STATUS_COLOR: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  SUCCESS: 'success', PARTIAL: 'warning', FAILED: 'error', RUNNING: 'info', PENDING: 'default',
};

export function SyncLogs() {
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState(false);
  const { data, isLoading, isError } = useSyncLogs({ limit: 100, status: status || undefined });
  const syncAll = useSyncAll();

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={2} flexWrap="wrap">
        <Typography variant="h4">Sync Logs</Typography>
        <Box display="flex" gap={2}>
          <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="">All</MenuItem>
            {['SUCCESS', 'PARTIAL', 'FAILED', 'RUNNING', 'PENDING'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
          <Button variant="contained" color="secondary" onClick={() => setConfirm(true)}>Sync All</Button>
        </Box>
      </Box>

      {isError && <Alert severity="error">Failed to load logs.</Alert>}

      <Paper variant="outlined">
        {/* Six columns with full timestamps are wider than a phone: scroll the table, not the
            page (see Dashboard for the measurement that motivated this). */}
        <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Symbol</TableCell><TableCell>Status</TableCell><TableCell>Started</TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Completed</TableCell>
              <TableCell align="right">Duration</TableCell><TableCell>Error</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={6}><Skeleton /></TableCell></TableRow>
            ))}
            {data?.items.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.symbol ?? 'ALL'}</TableCell>
                <TableCell><Chip size="small" color={STATUS_COLOR[l.status] ?? 'default'} label={l.status} /></TableCell>
                <TableCell>{new Date(l.startedAt).toLocaleString()}</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{l.completedAt ? new Date(l.completedAt).toLocaleString() : '—'}</TableCell>
                <TableCell align="right">{l.durationMs != null ? `${(l.durationMs / 1000).toFixed(1)}s` : '—'}</TableCell>
                <TableCell sx={{ maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.errorMessage ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </TableContainer>
      </Paper>

      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>Sync all stocks?</DialogTitle>
        <DialogContent>This enqueues a scrape for every tracked stock. Continue?</DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => { syncAll.mutate(); setConfirm(false); }}>Sync All</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
