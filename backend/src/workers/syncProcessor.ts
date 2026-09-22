import { Job, UnrecoverableError } from 'bullmq';
import { SyncJobData } from '../jobs/queues';
import { runOneSync } from '../services/syncRunner.service';
import { InvalidSymbolError } from '../types/errors';
import { deletedSymbolRepository } from '../repositories/deletedSymbol.repository';

/** Processes a single stock-sync job. */
export async function processSyncJob(job: Job<SyncJobData>): Promise<unknown> {
  const { symbol } = job.data;
  // A symbol a human removed stays removed. This is the path that kept restoring the one that was
  // deleted: the scraper persists through stock.upsert, so a job queued before the deletion — or
  // re-queued by a later pass — wrote the row straight back. Skipping is a success, not a failure:
  // nothing is wrong with the job, the symbol is simply not wanted.
  if (await deletedSymbolRepository.isDeleted(symbol)) {
    return { skipped: true, reason: 'symbol was removed from Scrapper' };
  }
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
