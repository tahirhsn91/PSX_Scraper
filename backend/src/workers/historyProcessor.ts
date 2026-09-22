import { Job, UnrecoverableError } from 'bullmq';
import { HistoryJobData } from '../jobs/queues';
import { runHistorySync } from '../services/historySync.service';
import { psxHistoricalScraper } from '../scrapers/historical.scraper';
import { childLogger } from '../utils/logger';
import { sourceBreaker } from '../utils/sourceBreaker';
import { InvalidSymbolError, NotFoundError } from '../types/errors';

export interface HistorySyncSkip {
  symbol: string;
  skipped: 'source-cooling';
  resumeAt: string | null;
}

/**
 * Processes a single history-sync job with progress reporting.
 *
 * A source in its cooldown window means the job is skipped rather than failed — the same
 * reason the index sync does it (#27): the source is refusing us, so a failure per symbol per
 * retry is noise about *our* queue, not about the data.
 */
export async function processHistoryJob(job: Job<HistoryJobData>): Promise<unknown> {
  const { symbol, range } = job.data;
  const source = psxHistoricalScraper.source;

  if (sourceBreaker.isCoolingDown(source)) {
    const resumeAt = sourceBreaker.resumeAt(source)?.toISOString() ?? null;
    childLogger({ symbol, op: 'history-sync' }).warn('history-sync.skipped', {
      reason: 'source-cooling',
      source,
      range,
      resumeAt,
    });
    return { symbol, skipped: 'source-cooling', resumeAt } satisfies HistorySyncSkip;
  }

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
