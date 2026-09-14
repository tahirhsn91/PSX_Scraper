import { env } from '../config';
import { logger } from '../utils/logger';
import { syncAllQueue, indexQueue, enqueueIndexSync } from './queues';
import { indexRepository } from '../repositories/index.repository';

/** One cron interval: an index whose last sync is older than this is treated as stale. */
const INDEX_STALE_MS = 60 * 60 * 1000;

/**
 * Register repeatable jobs:
 *  - `scheduled-sync-all` — full stock sync on CRON_EXPRESSION.
 *  - `scheduled-index-<SYMBOL>` — one per tracked index, on the same expression.
 *
 * BullMQ dedupes repeatable jobs by key, so multiple workers won't duplicate them.
 *
 * Also fires an immediate index sync when an index has never been synced or its last
 * sync is stale. Without that, a fresh deploy (or a fresh database) serves null values
 * until the next cron tick, which is exactly when `GET /api/v1/indices/KSE100` is most
 * likely to be called.
 */
export async function registerScheduler(): Promise<void> {
  await syncAllQueue.add(
    'scheduled-sync-all',
    { trigger: 'cron' },
    { repeat: { pattern: env.CRON_EXPRESSION }, jobId: 'scheduled-sync-all' },
  );
  logger.info('scheduler.registered', { cron: env.CRON_EXPRESSION });

  const indices = await indexRepository.findAll();
  for (const index of indices) {
    await indexQueue.add(
      'index-sync',
      { symbol: index.symbol, trigger: 'cron' },
      { repeat: { pattern: env.CRON_EXPRESSION }, jobId: `scheduled-index-${index.symbol}` },
    );
  }
  logger.info('scheduler.indices_registered', { count: indices.length });

  const stale = indices.filter(
    (i) => !i.lastSyncedAt || Date.now() - i.lastSyncedAt.getTime() > INDEX_STALE_MS,
  );
  for (const index of stale) {
    await enqueueIndexSync(index.symbol, 'cron');
  }
  if (stale.length) {
    logger.info('scheduler.indices_stale_enqueued', { symbols: stale.map((i) => i.symbol) });
  }
}
