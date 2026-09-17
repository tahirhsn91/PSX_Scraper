import { scrapeSymbol } from '../scrapers/orchestrator';
import { persistScrapeResult, hasUsablePrice } from '../repositories/scrapeResult.repository';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { stockRepository } from '../repositories/stock.repository';
import { psxQuoteScraper } from '../scrapers/psxQuotes.scraper';
import { childLogger } from '../utils/logger';
import { ProviderOutcome, ScrapeResult } from '../types/dto';

export interface SyncRunSummary {
  symbol: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  outcomes: ProviderOutcome[];
}

export type ProgressFn = (percent: number, note?: string) => Promise<void> | void;

/**
 * Stamp the scraped price with the session date from the DPS series instead of the wall clock.
 *
 * The company page carries no trade date, and keying the price row on `now()` appended a new
 * `stock_prices` row on every run (one symbol had 277) while making "newest row" mean "most
 * recently written" rather than "newest trade".
 *
 * Best-effort: when the series can't be reached the scraped value is left untouched, so a
 * transient network problem degrades to the previous behaviour instead of failing the sync.
 */
async function stampSessionDate(result: ScrapeResult): Promise<void> {
  if (!hasUsablePrice(result.price)) return;
  const snapshot = await psxQuoteScraper.fetchSnapshot(result.symbol).catch(() => null);
  if (!snapshot) return;
  result.price.lastTradeDate = snapshot.sessionDate.toISOString();
}

/**
 * Core sync unit: scrape → persist → SyncLog lifecycle. Used by the worker.
 * Throws on hard failure so BullMQ can apply its retry policy.
 */
export async function runOneSync(symbol: string, onProgress?: ProgressFn): Promise<SyncRunSummary> {
  const sym = symbol.toUpperCase();
  const log = childLogger({ symbol: sym, op: 'sync' });
  const stock = await stockRepository.findBySymbol(sym);
  const started = new Date();
  const syncLog = await syncLogRepository.start(sym, stock?.id ?? null);
  log.info('sync.start');
  await onProgress?.(10, 'scraping');

  try {
    const { result, outcomes, partial } = await scrapeSymbol(sym);
    await stampSessionDate(result);
    await onProgress?.(60, 'persisting');
    await persistScrapeResult(result);
    await onProgress?.(100, 'done');
    const status = partial ? 'PARTIAL' : 'SUCCESS';
    await syncLogRepository.complete(syncLog.id, status, started);
    log.info('sync.complete', { status });
    return { symbol: sym, status, outcomes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await syncLogRepository.complete(syncLog.id, 'FAILED', started, message);
    log.error('sync.failed', { message });
    throw err;
  }
}
