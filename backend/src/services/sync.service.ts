import { SyncStatus } from '@prisma/client';
import {
  syncQueue, syncAllQueue, enqueueSyncAll, enqueueSync, findExistingSyncJob,
  enqueueHistorySync, findExistingHistoryJob,
} from '../jobs/queues';
import { stockRepository } from '../repositories/stock.repository';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { NotFoundError } from '../types/errors';
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
    const [sync, syncAll] = await Promise.all([
      syncQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      syncAllQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    ]);
    const active = await syncQueue.getActive();
    return {
      queues: { 'stock-sync': sync, 'stock-sync-all': syncAll },
      inFlight: active.map((j) => j.data.symbol),
    };
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
