import { Queue } from 'bullmq';
import { createRedisConnection } from './connection';
import type { HistoryRange } from '../utils/range';

export const SYNC_QUEUE = 'stock-sync';
export const SYNC_ALL_QUEUE = 'stock-sync-all';
export const HISTORY_QUEUE = 'stock-history-sync';
export const INDEX_QUEUE = 'index-sync';
export const QUOTE_QUEUE = 'quote-sync';
/** Job name shared by the scheduler and the manual enqueue helper. */
export const QUOTE_POLL_JOB = 'quote-poll';

export interface SyncJobData { symbol: string; trigger: 'manual' | 'cron' | 'add' }
export interface SyncAllJobData { trigger: 'manual' | 'cron' }
export interface HistoryJobData { symbol: string; range: HistoryRange }
export interface IndexSyncJobData { symbol: string; trigger: 'manual' | 'cron' }
export interface QuotePollJobData { trigger: 'manual' | 'cron' }

const connection = createRedisConnection();

export const syncQueue = new Queue<SyncJobData>(SYNC_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400, count: 1000 },
  },
});

export const syncAllQueue = new Queue<SyncAllJobData>(SYNC_ALL_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400 },
  },
});

export const historyQueue = new Queue<HistoryJobData>(HISTORY_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 200 },
    removeOnFail: { age: 86400, count: 500 },
  },
});

export const indexQueue = new Queue<IndexSyncJobData>(INDEX_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 200 },
    removeOnFail: { age: 86400, count: 200 },
  },
});

/**
 * Live-quote poll — one job per tick that refreshes every tracked symbol, so there is no
 * per-symbol fan-out and no child job to de-dupe.
 *
 * `attempts: 1`: this runs every 5 minutes (see QUOTE_POLL_CRON) and the next tick is only
 * minutes away, so retrying a failed tick just competes with the fresh one. A symbol that
 * fails inside a tick is simply carried by the next tick.
 */
export const quoteQueue = new Queue<QuotePollJobData>(QUOTE_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400, count: 100 },
  },
});

/** Deterministic jobId → de-duplicates concurrent syncs for the same symbol.
 *  NOTE: BullMQ forbids ':' in custom job ids, so use '-'. */
export const syncJobId = (symbol: string): string => `sync-${symbol.toUpperCase()}`;
export const historyJobId = (symbol: string): string => `history-${symbol.toUpperCase()}`;

export async function enqueueHistorySync(symbol: string, range: HistoryRange) {
  return historyQueue.add(
    'history',
    { symbol: symbol.toUpperCase(), range },
    { jobId: historyJobId(symbol) },
  );
}

export async function findExistingHistoryJob(symbol: string) {
  return historyQueue.getJob(historyJobId(symbol));
}

/** Deterministic index job id, so a queued/active index sync is de-duplicated. */
export const indexJobId = (symbol: string): string => `index-${symbol.toUpperCase()}`;

export async function enqueueIndexSync(symbol: string, trigger: IndexSyncJobData['trigger']) {
  const jobId = indexJobId(symbol);
  // Same reasoning as enqueueSync: a finished job keeps its id and would silently
  // absorb the next request, so clear it before re-adding.
  const existing = await indexQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove().catch(() => undefined);
    }
  }
  return indexQueue.add('index-sync', { symbol: symbol.toUpperCase(), trigger }, { jobId });
}

export async function findExistingIndexJob(symbol: string) {
  return indexQueue.getJob(indexJobId(symbol));
}

export async function enqueueSync(symbol: string, trigger: SyncJobData['trigger']) {
  const jobId = syncJobId(symbol);
  // The jobId is deterministic (for de-dupe), so a job that already finished
  // (completed or failed) still occupies that id — BullMQ's `.add()` would
  // silently return the old, finished job instead of creating a new one,
  // making every future sync for that symbol a permanent no-op. Clear it
  // first so a finished job can actually be re-run. In-flight jobs
  // (waiting/active/delayed) are left alone — that's the real de-dupe case.
  const existing = await syncQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove().catch(() => undefined);
    }
  }
  return syncQueue.add('sync', { symbol: symbol.toUpperCase(), trigger }, { jobId });
}

export async function enqueueSyncAll(trigger: SyncAllJobData['trigger']) {
  return syncAllQueue.add('sync-all', { trigger }, { jobId: `sync-all-${Date.now()}` });
}

/**
 * Queue one quote-poll tick. The id is timestamped rather than fixed: a tick that is still
 * running should not swallow the next one, and stale finish-state can't block a re-add.
 */
export async function enqueueQuotePoll(trigger: QuotePollJobData['trigger']) {
  return quoteQueue.add(QUOTE_POLL_JOB, { trigger }, { jobId: `quote-poll-${Date.now()}` });
}

/** Return an existing queued/active job for a symbol, if any. */
export async function findExistingSyncJob(symbol: string) {
  return syncQueue.getJob(syncJobId(symbol));
}
