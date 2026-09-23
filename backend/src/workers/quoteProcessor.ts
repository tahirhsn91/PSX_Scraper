import { Job } from 'bullmq';
import { env } from '../config';
import { QuotePollJobData, KSE100_MEMBERSHIP_JOB } from '../jobs/queues';
import { syncKse100Membership } from '../services/kse100Membership.service';
import type { Kse100MembershipSummary } from '../services/kse100Membership.service';
import { stockRepository } from '../repositories/stock.repository';
import { upsertQuoteSnapshot } from '../repositories/stockPrice.repository';
import { psxQuoteScraper } from '../scrapers/psxQuotes.scraper';
import type { QuoteSnapshot } from '../scrapers/psxQuotes.scraper';
import { fetchSarmaayaTicker, SARMAYA_TICKER_SOURCE } from '../scrapers/sarmaayaTicker.scraper';
import { fetchSarmaayaQuotes, SARMAYA_QUOTE_SOURCE } from '../scrapers/sarmaayaQuote.scraper';
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
 * When the DPS fan-out last ran, in-process.
 *
 * A tick is cheap (one bulk request + a capped fan-out), but DPS is one request *per symbol* —
 * the load that earned the refusal in #27 — so it runs on its own slower interval and the
 * ticker serves the board on the ticks in between. Module scope is enough: one worker process
 * owns the repeatable job.
 */
let lastDpsRunAt = 0;

/**
 * Where the per-symbol walk resumes, in-process: the tail is asked for in slices so the host does
 * not answer `429`, and this is what keeps the slices moving forward instead of re-asking the
 * first N symbols every tick.
 */
let perSymbolCursor = 0;

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
export async function processQuotePollJob(
  job: Job<QuotePollJobData>,
): Promise<QuotePollSummary | Kse100MembershipSummary> {
  // The KSE-100 membership pass rides this queue because it is the same kind of work — a light,
  // schedule-driven refresh with no per-symbol fan-out — and page one of the dashboard depends on
  // it being current. Its own job name keeps the two summaries apart in the logs.
  if (job.name === KSE100_MEMBERSHIP_JOB) return syncKse100Membership();

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

  const dpsDue = Date.now() - lastDpsRunAt >= env.QUOTE_POLL_DPS_MIN_INTERVAL_MS;

  if (!dpsDue) {
    log.info('quote-poll.primary_deferred', {
      source: psxQuoteScraper.source,
      minIntervalMs: env.QUOTE_POLL_DPS_MIN_INTERVAL_MS,
    });
  } else if (sourceBreaker.isCoolingDown(psxQuoteScraper.source)) {
    log.warn('quote-poll.primary_cooling', {
      source: psxQuoteScraper.source,
      resumeAt: sourceBreaker.resumeAt(psxQuoteScraper.source)?.toISOString() ?? null,
    });
  } else {
    lastDpsRunAt = Date.now();
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

  // What both bulk sources left behind: the ticker's list does not cover everything we track —
  // measured 2026-09-23 it carried 471–485 rows against 508 tracked symbols, and the difference
  // is the ETFs (ACIETF), the preference shares (AGLNCPS) and the renamed tickers
  // (ENGRO → ENGROH). Those symbols kept the browser pass's reading from up to half an hour
  // earlier while the rest of the market ticked. One plain-JSON request each covers them.
  //
  // Walked in slices, not all at once: asking that host for the whole tail every minute earns
  // `http=429` (measured: ~36 requests a minute, a third of them refused), so a tick takes the
  // next slice and wraps — every tail symbol is still refreshed within a few minutes.
  const stillMissing = symbols.filter((symbol) => !bySymbol.has(symbol.toUpperCase()));
  if (stillMissing.length > 0) {
    const sliceSize = Math.max(0, env.SARMAYA_QUOTE_MAX_SYMBOLS);
    let targets = stillMissing;
    if (sliceSize > 0 && stillMissing.length > sliceSize) {
      const start = perSymbolCursor % stillMissing.length;
      targets = [...stillMissing.slice(start), ...stillMissing.slice(0, start)].slice(0, sliceSize);
      perSymbolCursor = (start + sliceSize) % stillMissing.length;
      log.info('quote-poll.per_symbol_rotated', {
        tail: stillMissing.length,
        asking: targets.length,
        cursor: perSymbolCursor,
      });
    }
    if (targets.length > 0) {
      try {
        const { snapshots: perSymbol, failures } = await fetchSarmaayaQuotes(targets, {
          max: sliceSize,
        });
        for (const snapshot of perSymbol) {
          const key = snapshot.symbol.toUpperCase();
          if (!bySymbol.has(key)) bySymbol.set(key, snapshot);
        }
        if (perSymbol.length > 0) {
          sources.push(SARMAYA_QUOTE_SOURCE);
          log.info('quote-poll.per_symbol_filled', {
            source: SARMAYA_QUOTE_SOURCE,
            filled: perSymbol.length,
            asked: targets.length,
            failed: failures.length,
            first: failures[0]?.error ?? null,
          });
        } else {
          log.warn('quote-poll.per_symbol_empty', {
            source: SARMAYA_QUOTE_SOURCE,
            asked: targets.length,
            first: failures[0]?.error ?? null,
          });
        }
      } catch (err) {
        log.warn('quote-poll.per_symbol_failed', {
          source: SARMAYA_QUOTE_SOURCE,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    snapshots: [...bySymbol.values()],
    // Symbols still without a reading after every source had its turn — the honest count of
    // what this tick could not refresh.
    failed: symbols.length - bySymbol.size,
    source: sources.length > 0 ? sources.join('+') : null,
  };
}
