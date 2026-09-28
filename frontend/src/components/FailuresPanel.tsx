import { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { useClearFailed } from '../api/hooks';
import { SectionCard } from './ui/SectionCard';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useToast } from './ui/ToastProvider';
import { formatRelative } from '../lib/format';
import type { QueueFailure, SyncStatus } from '../types';

/**
 * Turn a worker failure into a sentence that says what broke.
 *
 * The raw reasons were bundler internals (`(0 , import_stock.findSymbolsWithoutLatestMarketCap) is
 * not a function`), which name a symptom of a bad build rather than anything about the data — a
 * reader could not tell a stale deploy from a broken scraper. Only patterns we can actually
 * interpret are rewritten; anything else is shown verbatim (truncated) rather than guessed at.
 */
export function humaniseFailure(reason: string): { text: string; translated: boolean } {
  // Bundlers write these as `(0 , import_stock.findSymbolsWithoutLatestMarketCap) is not a function`
  // — the identifier is wrapped, so the pattern must allow the closing paren.
  const missingFn = reason.match(/([A-Za-z_$][\w$]*)\)?\s+is not a function/);
  if (missingFn) {
    return {
      text: `The worker build is missing the helper “${missingFn[1]}” — a deploy mismatch, not bad data.`,
      translated: true,
    };
  }
  const undefinedRead = reason.match(/Cannot read propert(?:y|ies) (?:of )?(?:undefined|null) \(reading '([^']+)'\)/);
  if (undefinedRead) {
    return { text: `The source page did not carry “${undefinedRead[1]}”.`, translated: true };
  }
  if (/timed? ?out|ETIMEDOUT|socket hang up|ECONNRESET/i.test(reason)) {
    return { text: 'The source stopped answering before the page finished loading.', translated: true };
  }
  if (/\b429\b|rate.?limit/i.test(reason)) {
    return { text: 'The source rate-limited us; the job backs off and tries again.', translated: true };
  }
  if (/net::ERR|getaddrinfo|ENOTFOUND/i.test(reason)) {
    return { text: 'The source could not be reached at all (DNS or connection refused).', translated: true };
  }
  return { text: reason.length > 180 ? `${reason.slice(0, 177)}…` : reason, translated: false };
}

interface GroupedFailure {
  text: string;
  translated: boolean;
  raw: string;
  count: number;
  newest: number | null;
  symbols: string[];
}

/** Collapse a queue's failures by their translated reason, keeping the newest time and symbols. */
function groupFailures(failures: QueueFailure[]): GroupedFailure[] {
  const byText = new Map<string, GroupedFailure>();
  for (const f of failures) {
    const { text, translated } = humaniseFailure(f.reason);
    const key = `${text}::${f.reason}`;
    const existing = byText.get(key);
    if (existing) {
      existing.count += 1;
      if (f.failedAt && (!existing.newest || f.failedAt > existing.newest)) existing.newest = f.failedAt;
      if (f.symbol && existing.symbols.length < 4 && !existing.symbols.includes(f.symbol)) {
        existing.symbols.push(f.symbol);
      }
    } else {
      byText.set(key, {
        text,
        translated,
        raw: f.reason,
        count: 1,
        newest: f.failedAt ?? null,
        symbols: f.symbol ? [f.symbol] : [],
      });
    }
  }
  return [...byText.values()].sort((a, b) => (b.newest ?? 0) - (a.newest ?? 0));
}

/**
 * The honest version of the Failed card.
 *
 * BullMQ reports a queue's failure count as the *size of its failed set*, so an entry whose job has
 * already been trimmed away keeps counting as a failure: unretryable, uninspectable, and
 * unclearable through the library. The old card also read only one queue, so real failures
 * elsewhere (`index-sync`, `quote-sync`, `stock-history-sync`) were invisible. This lists every
 * queue, dedupes repeated causes, reports orphans separately, and offers the one action that clears
 * them — behind a confirmation, because it destroys the evidence.
 */
export function FailuresPanel({ status }: { status?: SyncStatus }) {
  const clear = useClearFailed();
  const { notify } = useToast();
  const [confirmQueue, setConfirmQueue] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      Object.entries(status?.queues ?? {})
        .map(([queue, counts]) => ({
          queue,
          failed: counts.failed ?? 0,
          orphans: counts.orphans ?? 0,
          groups: groupFailures(status?.failures?.[queue] ?? []),
        }))
        .filter((r) => r.failed > 0 || r.orphans > 0),
    [status],
  );

  if (rows.length === 0) return null;

  const totalFailed = rows.reduce((n, r) => n + r.failed, 0);
  const totalOrphans = rows.reduce((n, r) => n + r.orphans, 0);
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const runClear = () => {
    const queue = confirmQueue;
    if (!queue) return;
    clear.mutate(queue, {
      onSuccess: (result) => {
        notify({
          message: `Cleared ${result.removed} ${plural(result.removed, 'job', 'jobs')} in ${result.queue}${
            result.orphans ? ` (${result.orphans} without a job behind them)` : ''
          }.`,
          severity: 'success',
        });
      },
      onError: () => notify({ message: `Could not clear ${queue}.`, severity: 'error' }),
    });
    setConfirmQueue(null);
  };

  return (
    <>
      <SectionCard
        title="Failed jobs"
        subtitle={`${totalFailed} ${plural(totalFailed, 'failure', 'failures')}${
          totalOrphans > 0 ? ` · ${totalOrphans} orphaned ${plural(totalOrphans, 'entry', 'entries')}` : ''
        }`}
        sx={{ mb: 2.5 }}
      >
        {totalOrphans > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {totalOrphans} {plural(totalOrphans, 'entry', 'entries')} in the failed set{' '}
            {plural(totalOrphans, 'has', 'have')} no job behind{' '}
            {plural(totalOrphans, 'it', 'them')} — the job was removed and can never be retried.
            They are not counted as failures; clearing the queue removes them.
          </Alert>
        )}

        <Stack spacing={1.5}>
          {rows.map((r) => (
            <Box key={r.queue} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Chip size="small" color={r.failed > 0 ? 'error' : 'default'} label={r.queue} />
                <Typography variant="body2">
                  {r.failed} {plural(r.failed, 'failed job', 'failed jobs')}
                </Typography>
                {r.orphans > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    · {r.orphans} orphaned {plural(r.orphans, 'entry', 'entries')}
                  </Typography>
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  disabled={clear.isPending}
                  onClick={() => setConfirmQueue(r.queue)}
                >
                  Clear failed
                </Button>
              </Stack>

              {r.groups.length > 0 && (
                <Stack spacing={0.5} sx={{ mt: 1.25 }}>
                  {r.groups.map((g) => (
                    <Box key={g.raw}>
                      <Stack direction="row" spacing={0.75} alignItems="baseline" useFlexGap sx={{ flexWrap: 'wrap' }}>
                        {g.count > 1 && <Chip size="small" variant="outlined" label={`×${g.count}`} />}
                        <Typography variant="body2" title={g.raw}>
                          {g.text}
                        </Typography>
                        {!g.translated && (
                          <Typography variant="caption" color="text.secondary">
                            (raw message from the worker)
                          </Typography>
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {g.symbols.length > 0 ? `${g.symbols.join(', ')} · ` : ''}
                        {g.newest ? `last failed ${formatRelative(g.newest)}` : 'time not recorded'}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
      </SectionCard>

      <ConfirmDialog
        open={confirmQueue !== null}
        title={`Clear failed jobs in ${confirmQueue}?`}
        message="This removes every failed job in that queue, including leftover entries with no job behind them. Waiting and running syncs are not affected, and the failures cannot be recovered afterwards."
        confirmLabel="Clear failed"
        tone="error"
        pending={clear.isPending}
        pendingLabel="Clearing…"
        onConfirm={runClear}
        onClose={() => setConfirmQueue(null)}
      />
    </>
  );
}
