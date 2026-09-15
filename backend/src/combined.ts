/**
 * Combined entrypoint: Express API + BullMQ workers + scheduler in ONE process.
 *
 * Why this exists: Render's free plan has no "Background Worker" service type at
 * all (confirmed in their Blueprint spec — free is "not available for private
 * services, background workers, or cron jobs"). To run this app on Render for
 * $0/mo, the worker logic has to live inside a process type that DOES support
 * `plan: free` — i.e. a Web Service. This file starts the HTTP server and the
 * three BullMQ workers + hourly scheduler side by side in the same event loop,
 * so one free Render Web Service does the job of the separate api+worker pair
 * used in the paid (`Dockerfile.api` + `Dockerfile.worker`) deployment.
 *
 * Trade-offs vs. the split deployment (see README "Free manual deployment"):
 * - Shares one 512MB/0.1 CPU instance between Express and Puppeteer/Chromium —
 *   keep SCRAPER_CONCURRENCY / WORKER_CONCURRENCY at 1 here.
 * - Free web services spin down after 15 min with no inbound HTTP traffic,
 *   which also pauses the in-process worker/scheduler — needs an external
 *   keep-alive pinger hitting /health (see README).
 * Not used by docker-compose.yml or the paid Render path — those keep the
 * API and worker as separate processes/containers.
 */
import { Worker } from 'bullmq';
import { createApp } from './app';
import { env } from './config';
import { logger } from './utils/logger';
import { disconnectPrisma } from './database/prisma';
import { createRedisConnection } from './jobs/connection';
import { SYNC_QUEUE, SYNC_ALL_QUEUE, HISTORY_QUEUE, QUOTE_QUEUE } from './jobs/queues';
import { registerScheduler } from './jobs/scheduler';
import { processSyncJob } from './workers/syncProcessor';
import { processSyncAllJob } from './workers/syncAllProcessor';
import { processHistoryJob } from './workers/historyProcessor';
import { processQuotePollJob } from './workers/quoteProcessor';
import { browserPool } from './scrapers/browserPool';

async function main() {
  // ---- HTTP server ----
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info('combined.api.started', { port: env.PORT, env: env.NODE_ENV });
  });

  // ---- BullMQ workers (in-process — no separate worker container/service) ----
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
  // The quote poll runs here too: it needs no browser, so it is cheap enough to share this
  // single small instance (the whole reason this combined entrypoint exists is Render free).
  const quoteWorker = new Worker(QUOTE_QUEUE, processQuotePollJob, {
    connection,
    concurrency: 1,
  });

  for (const w of [syncWorker, syncAllWorker, historyWorker, quoteWorker]) {
    w.on('completed', (job) => logger.info('job.completed', { queue: w.name, id: job.id }));
    w.on('failed', (job, err) =>
      logger.error('job.failed', { queue: w.name, id: job?.id, error: err.message }),
    );
    w.on('stalled', (id) => logger.warn('job.stalled', { queue: w.name, id }));
  }

  await registerScheduler();
  logger.info('combined.worker.started', { concurrency: env.WORKER_CONCURRENCY });

  const shutdown = async (sig: string) => {
    logger.info('combined.shutdown', { sig });
    server.close();
    await Promise.allSettled([
      syncWorker.close(),
      syncAllWorker.close(),
      historyWorker.close(),
      quoteWorker.close(),
    ]);
    await browserPool.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('combined.fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
