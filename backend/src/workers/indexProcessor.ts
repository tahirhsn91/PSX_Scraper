import { Job, UnrecoverableError } from 'bullmq';
import { IndexSyncJobData } from '../jobs/queues';
import { runIndexSync } from '../services/indexSync.service';
import { psxHistoricalScraper } from '../scrapers/historical.scraper';
import { childLogger } from '../utils/logger';
import { sourceBreaker } from '../utils/sourceBreaker';
import { NotFoundError } from '../types/errors';

export interface IndexSyncSkip {
  symbol: string;
  skipped: 'source-cooling';
  resumeAt: string | null;
}

/**
 * Processes a single market-index sync job with progress reporting.
 *
 * While the history source is cooling down the job is *skipped*, not failed: the source has
 * told us to stop asking (#27), and failing once per index per tick is how the queue reached
 * 200 failed members while reporting a source outage as if it were our bug. A skip leaves no
 * failed member and no `sync_logs` row — the run never happened — and the next tick after the
 * cooldown probes the source again.
 */
export async function processIndexJob(job: Job<IndexSyncJobData>): Promise<unknown> {
  const { symbol } = job.data;
  const source = psxHistoricalScraper.source;

  if (sourceBreaker.isCoolingDown(source)) {
    const resumeAt = sourceBreaker.resumeAt(source)?.toISOString() ?? null;
    childLogger({ symbol, op: 'index-sync' }).warn('index-sync.skipped', {
      reason: 'source-cooling',
      source,
      resumeAt,
    });
    return { symbol, skipped: 'source-cooling', resumeAt } satisfies IndexSyncSkip;
  }

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
