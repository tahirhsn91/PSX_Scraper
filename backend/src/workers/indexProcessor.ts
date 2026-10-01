import { Job, UnrecoverableError } from 'bullmq';
import { INDEX_BOARD_JOB, INDEX_CONTRIBUTION_JOB, IndexBoardJobData, IndexContributionJobData, IndexSyncJobData } from '../jobs/queues';
import { runIndexBoardPass } from '../services/indexScrape.service';
import { syncIndexContributions } from '../services/indexContribution.service';
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
export async function processIndexJob(job: Job<IndexSyncJobData | IndexBoardJobData | IndexContributionJobData>): Promise<unknown> {
  // The board pass shares this queue (and therefore the page pool) but takes no symbol: one page
  // carries every index. Its own tick decides intraday board read vs the post-close closing pass.
  if (job.name === INDEX_BOARD_JOB) {
    return runIndexBoardPass({});
  }
  // The contribution capture shares it for the same reason and also takes no symbol: one index's
  // whole constituent list arrives per request. It is the only job here that is *expected* to run
  // many times a session, because what it stores is a live figure rather than a published level.
  if (job.name === INDEX_CONTRIBUTION_JOB) {
    return syncIndexContributions();
  }
  if (!('symbol' in job.data)) {
    throw new UnrecoverableError(`index job ${job.name} carries no symbol`);
  }
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
