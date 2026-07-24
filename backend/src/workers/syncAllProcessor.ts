import { Job } from 'bullmq';
import { SyncAllJobData, enqueueSync } from '../jobs/queues';
import { stockRepository } from '../repositories/stock.repository';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { childLogger } from '../utils/logger';

/** Fan-out: enqueue one child sync job per tracked symbol (de-duped by jobId). */
export async function processSyncAllJob(job: Job<SyncAllJobData>): Promise<unknown> {
  const log = childLogger({ op: 'sync-all', trigger: job.data.trigger });
  const started = new Date();
  const batchLog = await syncLogRepository.start(null, null);
  const symbols = await stockRepository.findAllSymbols();
  log.info('sync-all.fanout', { count: symbols.length });

  let enqueued = 0;
  for (const symbol of symbols) {
    await enqueueSync(symbol, 'cron');
    enqueued++;
  }

  await syncLogRepository.complete(batchLog.id, 'SUCCESS', started);
  return { enqueued };
}
