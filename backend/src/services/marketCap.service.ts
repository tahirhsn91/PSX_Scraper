import {
  carryForwardLatestMarketCaps,
  clearLatestMarketCap,
  findSymbolsWithDuplicateMarketCap,
  findSymbolsWithoutLatestMarketCap,
  stockRepository,
  updateLatestMarketCaps,
} from '../repositories/stock.repository';
import {
  dropSharedGapValues,
  fetchMarketCaps,
  fetchTradingViewMarketCaps,
  MarketCapSnapshot,
} from '../scrapers/marketCap.scraper';
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
  /**
   * Gap-fill readings thrown away because another symbol reported the same figure — a source
   * artefact, not a market cap. Cleared rather than kept, so a previously-written wrong number does
   * not survive the refresh.
   */
  discarded: string[];
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

    // A cap is computed, so a gap-fill figure that lands on another symbol's cap is a source
    // artefact rather than data — discarded before it is written (see dropSharedGapValues).
    const { kept: gapKept, discarded } = dropSharedGapValues(scannerSnapshots, gapFill.snapshots);

    const snapshots: MarketCapSnapshot[] = [...scannerSnapshots, ...gapKept];
    const missing = symbols.filter((s) => !snapshots.some((snap) => snap.symbol === s));

    const written = await updateLatestMarketCaps(
      snapshots.map((s) => s.symbol),
      snapshots.map((s) => s.marketCap),
    );

    // The universe sync keeps writing newer rows, and a new row starts empty — so the freshest caps
    // are carried onto any newest row that has none, or the column would flicker between refreshes.
    const carried = await carryForwardLatestMarketCaps();

    // A rejected reading is cleared, not merely skipped: the symbol's row may already carry the
    // wrong number from an earlier run, and "leave it alone" would preserve exactly that. This runs
    // *after* the carry-forward so a cleared row cannot be refilled from a previous wrong value.
    //
    // A *stored* collision needs the same treatment, and cannot rely on this run's fetch: the walk
    // only asks about symbols with no cap, so a wrong value it wrote earlier would never be revisited
    // — stockanalysis reported 1.61B for both ESBL and HICL, 1.45B for ASTM and PAKD, 1.24B for ITANZ
    // and SHDT. Where the scanner vouches for a pair (sibling lines) the value stays; where it cannot,
    // the collision is a gap-fill artefact and the row goes back to a dash.
    const colliding = (await findSymbolsWithDuplicateMarketCap()).filter((s) => !covered.has(s));
    const cleared = await clearLatestMarketCap([
      ...new Set([...discarded.map((s) => s.symbol), ...colliding]),
    ]);

    const summary: MarketCapRefreshSummary = {
      tracked: symbols.length,
      fetched: snapshots.length,
      written,
      fromTradingView: scannerSnapshots.length,
      fromStockanalysis: gapFill.snapshots.length - discarded.length,
      missing,
      discarded: discarded.map((s) => s.symbol),
    };
    logger.info('marketcap.refresh_done', {
      tracked: summary.tracked,
      fetched: summary.fetched,
      written: summary.written,
      carried,
      cleared,
      fromTradingView: summary.fromTradingView,
      fromStockanalysis: summary.fromStockanalysis,
      missing: summary.missing.length,
      discarded: summary.discarded,
      errors: gapFill.errors,
    });
    return summary;
  },
};
