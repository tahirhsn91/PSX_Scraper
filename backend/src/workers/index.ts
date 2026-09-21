import { Worker } from 'bullmq';
import { createRedisConnection } from '../jobs/connection';
import {
  SYNC_QUEUE,
  SYNC_ALL_QUEUE,
  HISTORY_QUEUE,
  INDEX_QUEUE,
  QUOTE_QUEUE,
  UNIVERSE_QUEUE,
} from '../jobs/queues';
import { registerScheduler } from '../jobs/scheduler';
import { scrapeIndices } from '../services/indexScrape.service';
import { msUntilNextRun, runDailyBoard } from '../services/dailyBoard.service';
import { isMarketOpen } from '../utils/marketHours';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { processSyncJob } from './syncProcessor';
import { processSyncAllJob } from './syncAllProcessor';
import { processHistoryJob } from './historyProcessor';
import { processIndexJob } from './indexProcessor';
import { processQuotePollJob } from './quoteProcessor';
import { processUniverseJob } from './universeProcessor';
import { env } from '../config';
import { auditFeatureSettings } from '../config/envAudit';
import { logger } from '../utils/logger';
import { browserPool } from '../scrapers/browserPool';
import { disconnectPrisma } from '../database/prisma';

async function main() {
  const connection = createRedisConnection();

  // A sync cannot outlive the process that owns it: anything still RUNNING at boot was abandoned
  // by a previous worker (deploy, crash, restart) and would otherwise stay "running" forever on
  // the Sync Logs page.
  const swept = await syncLogRepository.sweepStale(5);
  if (swept > 0) logger.warn('worker.swept_stale_sync_logs', { count: swept });

  const syncWorker = new Worker(SYNC_QUEUE, processSyncJob, {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  });
  const syncAllWorker = new Worker(SYNC_ALL_QUEUE, processSyncAllJob, {
    connection,
    concurrency: 1,
  });
  const historyWorker = new Worker(HISTORY_QUEUE, processHistoryJob, {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  });
  // Serial: index syncs are browser-bound and share the same page pool as stocks.
  const indexWorker = new Worker(INDEX_QUEUE, processIndexJob, {
    connection,
    concurrency: 1,
  });
  // Serial: the poll is one job that already fans out with its own bounded concurrency,
  // and it must never compete with the browser-bound workers for memory.
  const quoteWorker = new Worker(QUOTE_QUEUE, processQuotePollJob, {
    connection,
    concurrency: 1,
  });
  // Concurrency 1 is the feature, not a default: the universe pass walks the board one symbol at
  // a time so ~500 page fetches trickle out instead of arriving as a burst (#27, #41).
  const universeWorker = new Worker(UNIVERSE_QUEUE, processUniverseJob, {
    connection,
    concurrency: 1,
  });

  for (const w of [syncWorker, syncAllWorker, historyWorker, indexWorker, quoteWorker, universeWorker]) {
    w.on('completed', (job) => logger.info('job.completed', { queue: w.name, id: job.id }));
    w.on('failed', (job, err) =>
      logger.error('job.failed', { queue: w.name, id: job?.id, error: err.message }),
    );
    w.on('stalled', (id) => logger.warn('job.stalled', { queue: w.name, id }));
  }

  await registerScheduler();
  logger.info('worker.started', { concurrency: env.WORKER_CONCURRENCY });

  /**
   * Index board snapshot: one page fetch per tick, no browser, idempotent upserts. Kept on a
   * plain interval rather than a BullMQ repeatable because it needs no queue semantics — a
   * duplicate tick can only rewrite the same day's rows.
   */
  const scrapeIndexBoard = (reason: string) => {
    if (env.INDEX_SCRAPE_MARKET_HOURS_ONLY && !isMarketOpen(new Date())) return;
    void scrapeIndices().catch((err) =>
      // Never fatal: a failed page fetch must not take the worker's other jobs down with it.
      logger.warn('index_scrape.failed', { reason, error: err instanceof Error ? err.message : String(err) }),
    );
  };
  const indexScrapeTimer = setInterval(() => scrapeIndexBoard('interval'), env.INDEX_SCRAPE_INTERVAL_MS);
  // One shortly after boot so a restarted worker does not wait a full interval.
  const indexScrapeBoot = setTimeout(() => scrapeIndexBoard('boot'), 5000);

  /**
   * The daily board pass: one request for the whole market at 02:00 Karachi, registering anything
   * listed that is not tracked yet and queueing every symbol for a refresh. A self-arming timer
   * rather than a queue repeatable, for the same reason as the index snapshot above: one run per
   * day needs no queue semantics, and a missed day is caught by the next one.
   *
   * Off unless DAILY_BOARD_ENABLED says otherwise, and it never throws into the worker: a failed
   * board fetch must not take the other jobs down with it.
   */
  let dailyBoardTimer: NodeJS.Timeout | null = null;
  const scheduleDailyBoard = () => {
    if (!env.DAILY_BOARD_ENABLED) return;
    const waitMs = msUntilNextRun(new Date(), env.DAILY_BOARD_HOUR);
    dailyBoardTimer = setTimeout(() => {
      void runDailyBoard().catch((err) =>
        logger.warn('daily_board.failed', { error: err instanceof Error ? err.message : String(err) }),
      );
      scheduleDailyBoard();
    }, waitMs);
    dailyBoardTimer.unref?.();
    logger.info('daily_board.scheduled', {
      inMinutes: Math.round(waitMs / 60000),
      hourKarachi: env.DAILY_BOARD_HOUR,
    });
  };
  scheduleDailyBoard();

  const shutdown = async (sig: string) => {
    logger.info('worker.shutdown', { sig });
    clearInterval(indexScrapeTimer);
    clearTimeout(indexScrapeBoot);
    if (dailyBoardTimer) clearTimeout(dailyBoardTimer);
    await Promise.allSettled([
      syncWorker.close(),
      syncAllWorker.close(),
      historyWorker.close(),
      indexWorker.close(),
      quoteWorker.close(),
      universeWorker.close(),
    ]);
    await browserPool.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('worker.fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
