import { env } from '../config';
import { logger } from '../utils/logger';
import { syncAllQueue } from './queues';

/**
 * Register a repeatable job that triggers a full sync on CRON_EXPRESSION.
 * BullMQ dedupes repeatable jobs by key, so multiple workers won't duplicate it.
 */
export async function registerScheduler(): Promise<void> {
  await syncAllQueue.add(
    'scheduled-sync-all',
    { trigger: 'cron' },
    { repeat: { pattern: env.CRON_EXPRESSION }, jobId: 'scheduled-sync-all' },
  );
  logger.info('scheduler.registered', { cron: env.CRON_EXPRESSION });
}
