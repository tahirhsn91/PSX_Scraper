import { SyncStatus } from '@prisma/client';
import {
  syncQueue, syncAllQueue, historyQueue, indexQueue, monitoredQueues,
  enqueueSyncAll, enqueueSync, findExistingSyncJob,
  enqueueHistorySync, findExistingHistoryJob,
} from '../jobs/queues';
import {
  clearQueueFailures, inspectQueueFailures, splitFailedMembers, type FailedJobInfo,
} from '../jobs/queueFailures';
import { stockRepository } from '../repositories/stock.repository';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { NotFoundError } from '../types/errors';
import { logger } from '../utils/logger';
import { MONITORED_QUEUES, type MonitoredQueueName } from '../utils/queueNames';
import type { HistoryRange } from '../utils/range';

export const syncService = {
  /** Enqueue a single-stock sync, reusing an existing queued/active job (de-dupe). */
  async syncOne(symbol: string) {
    const sym = symbol.toUpperCase();
    const stock = await stockRepository.findBySymbol(sym);
    if (!stock) throw new NotFoundError(`Stock not tracked: ${sym}`);
    const existing = await findExistingSyncJob(sym);
    if (existing) {
      const state = await existing.getState();
      if (['waiting', 'active', 'delayed'].includes(state)) {
        return { jobId: existing.id, symbol: sym, reused: true, state };
      }
    }
    const job = await enqueueSync(sym, 'manual');
    return { jobId: job.id, symbol: sym, reused: false, state: 'waiting' };
  },

  async syncAll() {
    const job = await enqueueSyncAll('manual');
    return { jobId: job.id };
  },

  async status() {
    // One pass over every queue the dashboard reports on. `failed` counts failed jobs that
    // still exist, and members of the failed set whose payload is gone are reported separately
    // as `orphans`: BullMQ's own counter is the set's cardinality (`ZCARD`), not a count of
    // jobs, so a leftover id used to read as a live failure that nothing could retry or clear
    // (and `index-sync` / `stock-history-sync` were not reported at all, hiding real ones).
    const summaries = await Promise.all(
      MONITORED_QUEUES.map(async (name) => {
        const queue = monitoredQueues[name];
        const [counts, failures] = await Promise.all([
          queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
          inspectQueueFailures(queue),
        ]);
        return { name, counts, failures };
      }),
    );

    const queues: Record<string, Record<string, number>> = {};
    const failures: Record<string, FailedJobInfo[]> = {};
    for (const { name, counts, failures: report } of summaries) {
      queues[name] = { ...counts, failed: report.failed, orphans: report.orphans };
      failures[name] = report.recent;
    }

    const active = await syncQueue.getActive();
    return {
      // Every queue the service reports on is listed here, keyed by the same names the
      // clear-failed action accepts.
      queues,
      failures,
      inFlight: active.map((j) => j.data.symbol),
    };
  },

  /**
   * Empty one queue's failed set, orphans included.
   *
   * Returns what it removed so the caller can tell "there was nothing to clear" from "the
   * ghosts are gone too" — the second number is the one BullMQ itself cannot produce.
   */
  async clearFailed(queueName: MonitoredQueueName) {
    const queue = monitoredQueues[queueName];
    const before = await inspectQueueFailures(queue, 0);
    const { removed, orphans } = await clearQueueFailures(queue);
    logger.info('sync.failed_cleared', {
      queue: queueName, removed, orphans, countedAsFailed: before.failed,
    });
    return { queue: queueName, removed, orphans, countedAsFailed: before.failed };
  },

  async jobStatus(symbol: string) {
    const job = await findExistingSyncJob(symbol);
    if (!job) return null;
    return {
      jobId: job.id,
      state: await job.getState(),
      progress: job.progress,
      returnValue: job.returnvalue,
      failedReason: job.failedReason,
    };
  },

  /** Enqueue a history fetch for a symbol+range.
   *  Reuses an in-flight job (true de-dupe); clears a finished job so a new
   *  range can be fetched immediately without waiting for retention to expire. */
  async syncHistory(symbol: string, range: HistoryRange) {
    const sym = symbol.toUpperCase();
    const stock = await stockRepository.findBySymbol(sym);
    if (!stock) throw new NotFoundError(`Stock not tracked: ${sym}`);
    const existing = await findExistingHistoryJob(sym);
    if (existing) {
      const state = await existing.getState();
      if (['waiting', 'active', 'delayed'].includes(state)) {
        return { jobId: existing.id, symbol: sym, range, reused: true, state };
      }
      // Completed/failed job still holds the de-dupe id — remove it so we can re-run.
      await existing.remove().catch(() => undefined);
    }
    const job = await enqueueHistorySync(sym, range);
    return { jobId: job.id, symbol: sym, range, reused: false, state: 'waiting' };
  },

  /** Live status + progress for a symbol's history fetch job. */
  async historyJobStatus(symbol: string) {
    const job = await findExistingHistoryJob(symbol);
    if (!job) return { state: 'none', progress: null, returnValue: null, failedReason: null };
    return {
      jobId: job.id,
      state: await job.getState(),
      progress: job.progress,
      returnValue: job.returnvalue,
      failedReason: job.failedReason,
    };
  },

  async logs(params: { symbol?: string; status?: SyncStatus; page: number; limit: number }) {
    const offset = (params.page - 1) * params.limit;
    const { items, total } = await syncLogRepository.list({
      symbol: params.symbol,
      status: params.status,
      limit: params.limit,
      offset,
    });
    return {
      items: items.map((l) => ({
        id: l.id, symbol: l.symbol, status: l.status, startedAt: l.startedAt,
        completedAt: l.completedAt, durationMs: l.durationMs, errorMessage: l.errorMessage,
      })),
      page: params.page, limit: params.limit, total, totalPages: Math.ceil(total / params.limit),
    };
  },
};
