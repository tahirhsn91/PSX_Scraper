import { Job, UnrecoverableError } from 'bullmq';
import { HistoryJobData } from '../jobs/queues';
import { runHistorySync } from '../services/historySync.service';
import { InvalidSymbolError, NotFoundError } from '../types/errors';

/** Processes a single history-sync job with progress reporting. */
export async function processHistoryJob(job: Job<HistoryJobData>): Promise<unknown> {
  const { symbol, range } = job.data;
  try {
    return await runHistorySync(symbol, range, (percent, note) =>
      job.updateProgress({ percent, note }),
    );
  } catch (err) {
    if (err instanceof InvalidSymbolError || err instanceof NotFoundError) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}
