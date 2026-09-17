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
import { processSyncJob } from './syncProcessor';
import { processSyncAllJob } from './syncAllProcessor';
import { processHistoryJob } from './historyProcessor';
import { processIndexJob } from './indexProcessor';
import { processQuotePollJob } from './quoteProcessor';
import { processUniverseJob } from './universeProcessor';
import { env } from '../config';
import { logger } from '../utils/logger';
import { browserPool } from '../scrapers/browserPool';
import { disconnectPrisma } from '../database/prisma';

async function main() {
  const connection = createRedisConnection();

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

  const shutdown = async (sig: string) => {
    logger.info('worker.shutdown', { sig });
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
