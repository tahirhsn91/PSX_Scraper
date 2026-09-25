import { findSymbolsWithoutLatestMarketCap, stockRepository, updateLatestMarketCaps } from '../repositories/stock.repository';
import { fetchMarketCaps, fetchTradingViewMarketCaps, MarketCapSnapshot } from '../scrapers/marketCap.scraper';
import { env } from '../config';
import { logger } from '../utils/logger';

export interface MarketCapRefreshSummary {
  /** Symbols we track. */
  tracked: number;
  /** Symbols a source reported a cap for. */
  fetched: number;
  /** Rows actually written (the newest price row per symbol). */
  written: number;
  fromTradingView: number;
  fromStockanalysis: number;
  /** Tracked symbols nobody reported a cap for — the dashboard shows those as a dash. */
  missing: string[];
}

/**
 * Refresh the market cap on every tracked symbol's newest price row.
 *
 * The request budget is the design constraint. PSX's own company page — the authoritative source —
 * is refused at the edge (#27/#71), so caps come from TradingView's scanner (batched: two POSTs
 * cover our whole book) and, for what the scanner leaves null, one spaced request per symbol to
 * stockanalysis. That is ~150 requests for 508 symbols, which is why this runs on its own slow
 * schedule instead of on the poll's minute tick: a cap moves with price, not with the tick, and
 * the DPS leg already demonstrated what a per-symbol fan-out earns.
 *
 * A symbol nobody reports stays exactly as it was — never written as zero, never inferred from the
 * price. `missing` reports that remainder instead of hiding it.
 */
export const marketCapService = {
  async refresh(): Promise<MarketCapRefreshSummary> {
    const symbols = await stockRepository.findAllSymbols();

    // Two passes on purpose. The scanner answers in bulk for most of the book, so it runs over
    // everything; the per-symbol walk then runs only for what the scanner could not serve *and*
    // which has no cap yet — so the walk's cost falls as coverage rises, instead of asking the same
    // 150 pages every half hour and earning the same refusal (#27).
    const scannerSnapshots = await fetchTradingViewMarketCaps(symbols);
    const covered = new Set(scannerSnapshots.map((s) => s.symbol));
    const gaps = (await findSymbolsWithoutLatestMarketCap()).filter((s) => !covered.has(s));
    const gapFill = await fetchMarketCaps(gaps, {
      scanner: false,
      delayMs: env.MARKET_CAP_GAP_DELAY_MS,
    });

    const snapshots: MarketCapSnapshot[] = [...scannerSnapshots, ...gapFill.snapshots];
    const missing = symbols.filter((s) => !snapshots.some((snap) => snap.symbol === s));

    const written = await updateLatestMarketCaps(
      snapshots.map((s) => s.symbol),
      snapshots.map((s) => s.marketCap),
    );

    const summary: MarketCapRefreshSummary = {
      tracked: symbols.length,
      fetched: snapshots.length,
      written,
      fromTradingView: scannerSnapshots.length,
      fromStockanalysis: gapFill.snapshots.length,
      missing,
    };
    logger.info('marketcap.refresh_done', {
      tracked: summary.tracked,
      fetched: summary.fetched,
      written: summary.written,
      fromTradingView: summary.fromTradingView,
      fromStockanalysis: summary.fromStockanalysis,
      missing: summary.missing.length,
      errors: gapFill.errors,
    });
    return summary;
  },
};
