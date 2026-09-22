import { Job } from 'bullmq';
import { env } from '../config';
import { QuotePollJobData } from '../jobs/queues';
import { stockRepository } from '../repositories/stock.repository';
import { upsertQuoteSnapshot } from '../repositories/stockPrice.repository';
import { psxQuoteScraper } from '../scrapers/psxQuotes.scraper';
import type { QuoteSnapshot } from '../scrapers/psxQuotes.scraper';
import { fetchSarmaayaTicker, SARMAYA_TICKER_SOURCE } from '../scrapers/sarmaayaTicker.scraper';
import { isMarketOpen } from '../utils/marketHours';
import { sourceBreaker } from '../utils/sourceBreaker';
import { childLogger } from '../utils/logger';
import type { ContextLogger } from '../utils/logger';

export interface QuotePollSummary {
  symbols: number;
  fetched: number;
  written: number;
  failed: number;
  /** Which source served the tick — the primary, or the fallback the log names. */
  source?: string;
  skipped?: 'market-closed' | 'source-cooling' | 'no-source';
  /** When a cooling source is expected back, ISO — set with `skipped: 'source-cooling'`. */
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
  // dropping us is what earned the refusal in the first place. Skipping the *primary* is
  // right; skipping the tick is not — that is what left every symbol on the last full sync's
  // price. The market-wide ticker costs one request and answers, so the tick still lands.
  const { snapshots, failed, source } = await collectSnapshots(symbols, log);

  if (source === null) {
    const resumeAt = sourceBreaker.resumeAt(psxQuoteScraper.source)?.toISOString() ?? null;
    log.warn('quote-poll.skipped', { reason: 'no-source', resumeAt });
    return {
      symbols: symbols.length,
      fetched: 0,
      written: 0,
      failed: 0,
      skipped: 'no-source',
      resumeAt,
      durationMs: Date.now() - started,
    };
  }

  let written = 0;
  for (const snapshot of snapshots) {
    if (await upsertQuoteSnapshot(snapshot)) written += 1;
  }

  const summary: QuotePollSummary = {
    symbols: symbols.length,
    fetched: snapshots.length,
    written,
    failed,
    source,
    durationMs: Date.now() - started,
  };
  log.info('quote-poll.done', summary);
  return summary;
}

/**
 * Snapshots for one tick, from every source that has something: the DPS series normally, the
 * market-wide ticker for whatever it could not serve.
 *
 * `source: null` means nothing answered and the caller reports a skip — never a partial write
 * dressed up as a tick.
 */
async function collectSnapshots(
  symbols: string[],
  log: ContextLogger,
): Promise<{
  snapshots: QuoteSnapshot[];
  failed: number;
  source: string | null;
}> {
  const bySymbol = new Map<string, QuoteSnapshot>();
  const sources: string[] = [];

  if (sourceBreaker.isCoolingDown(psxQuoteScraper.source)) {
    log.warn('quote-poll.primary_cooling', {
      source: psxQuoteScraper.source,
      resumeAt: sourceBreaker.resumeAt(psxQuoteScraper.source)?.toISOString() ?? null,
    });
  } else {
    const { snapshots, failures } = await psxQuoteScraper.fetchMany(symbols);
    for (const snapshot of snapshots) bySymbol.set(snapshot.symbol.toUpperCase(), snapshot);
    if (snapshots.length > 0) sources.push(psxQuoteScraper.source);
    if (failures.length > 0) {
      // A source that is refusing us drops *some* requests rather than all of them, so a
      // partial tick is the normal shape of this outage, not an exception: measured on
      // 2026-09-22 the series answered 100 of 509 symbols in one tick.
      log.warn('quote-poll.primary_partial', {
        source: psxQuoteScraper.source,
        failed: failures.length,
        of: symbols.length,
      });
    }
  }

  // Whatever the primary could not serve comes from the market-wide ticker: one request covers
  // the whole board, so filling the gaps costs a request rather than one per symbol — and
  // leaving them would serve the last full sync's price for the rest of the session.
  const missing = symbols.filter((symbol) => !bySymbol.has(symbol.toUpperCase()));
  if (missing.length > 0) {
    try {
      const filled = await fetchSarmaayaTicker(missing);
      for (const snapshot of filled) {
        const key = snapshot.symbol.toUpperCase();
        if (!bySymbol.has(key)) bySymbol.set(key, snapshot);
      }
      if (filled.length > 0) {
        sources.push(SARMAYA_TICKER_SOURCE);
        log.info('quote-poll.fallback_filled', {
          source: SARMAYA_TICKER_SOURCE,
          filled: filled.length,
          missing: missing.length,
        });
      } else {
        log.warn('quote-poll.fallback_empty', { source: SARMAYA_TICKER_SOURCE, missing: missing.length });
      }
    } catch (err) {
      log.warn('quote-poll.fallback_failed', {
        source: SARMAYA_TICKER_SOURCE,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    snapshots: [...bySymbol.values()],
    // Symbols still without a reading after both sources had their turn — the honest count of
    // what this tick could not refresh.
    failed: symbols.length - bySymbol.size,
    source: sources.length > 0 ? sources.join('+') : null,
  };
}
