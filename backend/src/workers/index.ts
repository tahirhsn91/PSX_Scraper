import { Worker } from 'bullmq';
import { createRedisConnection } from '../jobs/connection';
import { SYNC_QUEUE, SYNC_ALL_QUEUE, HISTORY_QUEUE, INDEX_QUEUE } from '../jobs/queues';
import { registerScheduler } from '../jobs/scheduler';
import { processSyncJob } from './syncProcessor';
import { processSyncAllJob } from './syncAllProcessor';
import { processHistoryJob } from './historyProcessor';
import { processIndexJob } from './indexProcessor';
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

  for (const w of [syncWorker, syncAllWorker, historyWorker, indexWorker]) {
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
