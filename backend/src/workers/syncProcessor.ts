import { Job, UnrecoverableError } from 'bullmq';
import { SyncJobData } from '../jobs/queues';
import { runOneSync } from '../services/syncRunner.service';
import { InvalidSymbolError } from '../types/errors';

/** Processes a single stock-sync job. */
export async function processSyncJob(job: Job<SyncJobData>): Promise<unknown> {
  const { symbol } = job.data;
  try {
    return await runOneSync(symbol, (p, note) => job.updateProgress({ percent: p, note }));
  } catch (err) {
    // Permanent errors must not be retried.
    if (err instanceof InvalidSymbolError) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}
