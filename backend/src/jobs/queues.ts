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

/**
 * How long a delete waits for an in-flight sync before going ahead without it.
 * A sync is a few seconds of scraping; this bounds the wait so a stuck job cannot hang a
 * delete request.
 */
const ACTIVE_JOB_WAIT_MS = 20_000;
const ACTIVE_JOB_POLL_MS = 500;

/**
 * Drop the pending sync job for a symbol, if one is queued.
 *
 * A sync job carries only the symbol, and the scraper persists through `stock.upsert`, so a job
 * left in the queue re-creates the row it was enqueued for: the stock a user just deleted comes
 * back with a fresh price row attached. That is not hypothetical — a delisted symbol kept
 * reappearing on the dashboard after every container restart because its cron-enqueued job was
 * still sitting in Redis.
 *
 * Returns `null` when there was no job, the state it was in when cancelled, or `'active'` when
 * a job was still running after the bounded wait (it cannot be removed, so the caller decides).
 */
export async function cancelSyncJob(symbol: string): Promise<string | null> {
  const job = await syncQueue.getJob(syncJobId(symbol));
  if (!job) return null;

  if ((await job.getState()) === 'active') {
    const deadline = Date.now() + ACTIVE_JOB_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, ACTIVE_JOB_POLL_MS));
      const state = await job.getState();
      if (state !== 'active') {
        await job.remove().catch(() => undefined);
        return state;
      }
    }
    return 'active';
  }

  const state = await job.getState();
  await job.remove().catch(() => undefined);
  return state;
}

export async function enqueueSyncAll(trigger: SyncAllJobData['trigger']) {
  return syncAllQueue.add('sync-all', { trigger }, { jobId: `sync-all-${Date.now()}` });
}

export const UNIVERSE_QUEUE = 'universe-sync';
/** The pass job: discovers the board and hands out one job per symbol. */
export const UNIVERSE_PASS_JOB = 'universe-pass';
export const UNIVERSE_SYMBOL_JOB = 'universe-symbol';

export interface UniverseJobData {
  /**
   * `auto` is what the schedule asks for: the cron fires at a fixed, timezone-independent rate
   * and the runner decides from the PKT clock whether that means an in-hours pass, the
   * once-per-session closing pass, or nothing at all.
   */
  kind: 'auto' | 'intraday' | 'close';
  symbol?: string;
}

/**
 * The universe pass (#41).
 *
 * `attempts: 1` — a pass is a fan-out, not a unit of work: the next tick starts a fresh one as
 * soon as this drains, so retrying it would only race the newer pass. Per-symbol jobs are the
 * ones that retry.
 */
export const universeQueue = new Queue<UniverseJobData>(UNIVERSE_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400, count: 100 },
  },
});

/**
 * Enqueue one job per symbol, each delayed by its position in the list.
 *
 * The delay is the pacing: the worker runs one at a time, so a 500-symbol pass spreads over
 * roughly `pacing * 500` instead of arriving at the source as a burst. `addBulk` keeps it to a
 * single round trip rather than 500.
 *
 * Deliberately NO `jobId`: a deterministic id per symbol looks like free de-duplication, but it
 * is harmful here. `addBulk` writes each job's hash and then its queue entry, so a worker killed
 * part-way through leaves hashes with no queue entry — and a later pass handing BullMQ the same
 * id is told "already queued" for every one of them, so those symbols are silently never synced
 * again. Auto ids make every pass a clean set of jobs; overlapping passes are prevented by the
 * pass lock in universeRunner instead.
 */
export async function enqueueUniverseSymbols(
  symbols: string[],
  kind: UniverseJobData['kind'],
  pacingMs: number,
): Promise<void> {
  const jobs = symbols.map((symbol, i) => ({
    name: UNIVERSE_SYMBOL_JOB,
    data: { kind, symbol: symbol.toUpperCase() },
    opts: {
      delay: i * pacingMs,
      attempts: 2,
      backoff: { type: 'exponential' as const, delay: 10_000 },
      removeOnComplete: { age: 3600, count: 2000 },
      removeOnFail: { age: 86400, count: 2000 },
    },
  }));
  await universeQueue.addBulk(jobs);
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
