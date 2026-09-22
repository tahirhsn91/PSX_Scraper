import { Job } from 'bullmq';
import { env } from '../config';
import { QuotePollJobData } from '../jobs/queues';
import { stockRepository } from '../repositories/stock.repository';
import { upsertQuoteSnapshot } from '../repositories/stockPrice.repository';
import { psxQuoteScraper } from '../scrapers/psxQuotes.scraper';
import { isMarketOpen } from '../utils/marketHours';
import { sourceBreaker } from '../utils/sourceBreaker';
import { childLogger } from '../utils/logger';

export interface QuotePollSummary {
  symbols: number;
  fetched: number;
  written: number;
  failed: number;
  skipped?: 'market-closed' | 'source-cooling';
  /** When a cooling source is expected back, ISO — only set with `skipped: 'source-cooling'`. */
  resumeAt?: string | null;
  durationMs: number;
}

/**
 * Refresh price / change% for every tracked symbol — the tick behind "no more manual
 * Sync All".
 *
 * Deliberately NOT the company-page scrape: that needs Chromium (~4.7s per symbol, ~20s per
 * fan-out) and only changes daily for ratios/dividends/financials. This reads the DPS series
 * over plain HTTP instead — measured at 1.3s for 12 symbols in parallel, ~40KB each — so a
 * one-minute cadence costs seconds per tick.
 *
 * No `sync_logs` row is written per tick on purpose: 288/day would drown the real per-symbol
 * sync history the UI reads. The summary goes to the log stream, and the persisted row's
 * `lastTradeDate` is the proof the tick ran.
 */
export async function processQuotePollJob(job: Job<QuotePollJobData>): Promise<QuotePollSummary> {
  const log = childLogger({ op: 'quote-poll', trigger: job.data.trigger });
  const started = Date.now();

  // Outside the session the series returns what it already returned, so a tick there is load
  // for no new data — unless the guard is switched off (QUOTE_POLL_MARKET_HOURS_ONLY=false).
  if (env.QUOTE_POLL_MARKET_HOURS_ONLY && !isMarketOpen(new Date())) {
    log.info('quote-poll.skipped', { reason: 'market-closed' });
    return {
      symbols: 0,
      fetched: 0,
      written: 0,
      failed: 0,
      skipped: 'market-closed',
      durationMs: Date.now() - started,
    };
  }

  const symbols = await stockRepository.findAllSymbols();

  // A refused source is the one case where a tick must not fan out at all (#27): the poll is
  // the highest-volume caller we have, and asking 25 times per minute while the source is
  // dropping us is what earned the refusal in the first place.
  if (sourceBreaker.isCoolingDown(psxQuoteScraper.source)) {
    const resumeAt = sourceBreaker.resumeAt(psxQuoteScraper.source)?.toISOString() ?? null;
    log.warn('quote-poll.skipped', { reason: 'source-cooling', resumeAt });
    return {
      symbols: symbols.length,
      fetched: 0,
      written: 0,
      failed: 0,
      skipped: 'source-cooling',
      resumeAt,
      durationMs: Date.now() - started,
    };
  }

  const { snapshots, failures } = await psxQuoteScraper.fetchMany(symbols);

  let written = 0;
  for (const snapshot of snapshots) {
    if (await upsertQuoteSnapshot(snapshot)) written += 1;
  }

  const summary: QuotePollSummary = {
    symbols: symbols.length,
    fetched: snapshots.length,
    written,
    failed: failures.length,
    durationMs: Date.now() - started,
  };
  log.info('quote-poll.done', summary);
  return summary;
}
