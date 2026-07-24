import { Queue } from 'bullmq';
import { createRedisConnection } from './connection';
import type { HistoryRange } from '../utils/range';

export const SYNC_QUEUE = 'stock-sync';
export const SYNC_ALL_QUEUE = 'stock-sync-all';
export const HISTORY_QUEUE = 'stock-history-sync';

export interface SyncJobData { symbol: string; trigger: 'manual' | 'cron' | 'add' }
export interface SyncAllJobData { trigger: 'manual' | 'cron' }
export interface HistoryJobData { symbol: string; range: HistoryRange }

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

export async function enqueueSync(symbol: string, trigger: SyncJobData['trigger']) {
  return syncQueue.add('sync', { symbol: symbol.toUpperCase(), trigger }, { jobId: syncJobId(symbol) });
}

export async function enqueueSyncAll(trigger: SyncAllJobData['trigger']) {
  return syncAllQueue.add('sync-all', { trigger }, { jobId: `sync-all-${Date.now()}` });
}

/** Return an existing queued/active job for a symbol, if any. */
export async function findExistingSyncJob(symbol: string) {
  return syncQueue.getJob(syncJobId(symbol));
}
