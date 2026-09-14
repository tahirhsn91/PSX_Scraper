import { Job, UnrecoverableError } from 'bullmq';
import { IndexSyncJobData } from '../jobs/queues';
import { runIndexSync } from '../services/indexSync.service';
import { NotFoundError } from '../types/errors';

/** Processes a single market-index sync job with progress reporting. */
export async function processIndexJob(job: Job<IndexSyncJobData>): Promise<unknown> {
  const { symbol } = job.data;
  try {
    return await runIndexSync(symbol, (percent, note) => job.updateProgress({ percent, note }));
  } catch (err) {
    // An untracked index is a permanent failure — retrying cannot help.
    if (err instanceof NotFoundError) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}
