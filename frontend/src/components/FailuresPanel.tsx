import { useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Paper, Stack, Typography,
} from '@mui/material';
import { useClearFailed } from '../api/hooks';
import type { SyncStatus } from '../types';

/**
 * The honest version of the Failed card.
 *
 * BullMQ reports a queue's failure count as the *size of its failed set*, so an entry whose job
 * has already been trimmed away keeps counting as a failure: unretryable, uninspectable, and
 * unclearable through the library. At the same time the old card only ever read one queue, so
 * real failures elsewhere (`index-sync`, `stock-history-sync`) were invisible. This panel lists
 * every queue, shows the failures that still exist with their reason, reports the orphans
 * separately, and offers the one action that can clear them.
 */
export function FailuresPanel({ status }: { status?: SyncStatus }) {
  const clear = useClearFailed();
  const [confirm, setConfirm] = useState<string | null>(null);

  const rows = Object.entries(status?.queues ?? {})
    .map(([queue, counts]) => ({
      queue,
      failed: counts.failed ?? 0,
      orphans: counts.orphans ?? 0,
      recent: status?.failures?.[queue] ?? [],
    }))
    .filter((r) => r.failed > 0 || r.orphans > 0);

  if (rows.length === 0) return null;

  const totalFailed = rows.reduce((n, r) => n + r.failed, 0);
  const totalOrphans = rows.reduce((n, r) => n + r.orphans, 0);
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" mb={1}>
          <Typography variant="h6">Failed jobs</Typography>
          <Typography variant="caption" color="text.secondary">
            {totalFailed} {plural(totalFailed, 'failure', 'failures')}
            {totalOrphans > 0 ? ` · ${totalOrphans} orphaned ${plural(totalOrphans, 'entry', 'entries')}` : ''}
          </Typography>
        </Stack>

        {totalOrphans > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {totalOrphans} {plural(totalOrphans, 'entry', 'entries')} in the failed set {plural(totalOrphans, 'has', 'have')} no job
            behind {plural(totalOrphans, 'it', 'them')} — the job was removed and can never be retried. {plural(totalOrphans, 'It is', 'They are')} not
            counted as {plural(totalOrphans, 'a failure', 'failures')}; clearing the queue removes {plural(totalOrphans, 'it', 'them')}.
          </Alert>
        )}

        <Stack spacing={1.5}>
          {rows.map((r) => (
            <Box key={r.queue} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" color={r.failed > 0 ? 'error' : 'default'} label={r.queue} />
                <Typography variant="body2">{r.failed} {plural(r.failed, 'failed job', 'failed jobs')}</Typography>
                {r.orphans > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    · {r.orphans} orphaned {plural(r.orphans, 'entry', 'entries')}
                  </Typography>
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={clear.isPending}
                  onClick={() => setConfirm(r.queue)}
                >
                  Clear failed
                </Button>
              </Stack>

              {r.recent.length > 0 && (
                <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                  {r.recent.map((f) => (
                    <li key={f.id}>
                      <Typography variant="caption" color="text.secondary">
                        <strong>{f.symbol ?? '—'}</strong> · {f.reason}
                        {f.failedAt ? ` · ${new Date(f.failedAt).toLocaleString()}` : ''}
                      </Typography>
                    </li>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Stack>
      </Paper>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)}>
        <DialogTitle>Clear failed jobs in {confirm}?</DialogTitle>
        <DialogContent>
          This removes every failed job in that queue, including leftover entries that have no job
          behind them. Waiting and running syncs are not affected.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => { if (confirm) clear.mutate(confirm); setConfirm(null); }}
          >
            Clear failed
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
