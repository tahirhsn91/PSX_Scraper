import { fetchBetaSeries, recordBeta, type BetaWriteOutcome } from '../repositories/beta.repository';
import { stockRepository } from '../repositories/stock.repository';
import { childLogger } from '../utils/logger';

/**
 * Beta, measured against the KSE-100 on our own daily history (#79, criterion 7).
 *
 * Every other ratio on the valuation card is read from a source. Beta is not: no source we can
 * reach publishes one (Sarmaaya's fundamentals payload carries no such field), so borrowing it
 * would mean inventing it. What we do have is the pair of series its textbook definition needs —
 * the symbol's daily closes and the KSE-100's daily closes — so beta is computed here, and the
 * window it was computed over travels with the value.
 *
 * The stated window is **the newest 250 KSE-100 sessions, about one trading year**. A return is
 * taken only on a session where *both* the symbol and the index have a close, and only between two
 * sessions that are adjacent on the exchange's calendar: a symbol that did not trade for a week
 * contributes no return across that gap (never a five-day move compared against a one-day one, and
 * never a close carried forward from another day). Fewer than `MIN_OBSERVATIONS` aligned sessions
 * is not a one-year beta, so the answer is the dash — `value: null`, with the reason and the window
 * reported beside it — rather than a figure derived from a handful of days.
 *
 * One implementation, two callers: the sync writes the result into `ratios.beta`
 * (`refreshSymbol`), and the detail payload computes it live (`forSymbol`) so that the window it
 * prints is exactly the window the value came from.
 */

/** The index beta is measured against. */
export const BETA_INDEX_SYMBOL = 'KSE100';
/** The window, in exchange sessions: 250 KSE-100 sessions is about one trading year. */
export const BETA_WINDOW_SESSIONS = 250;
/** The window's label for the UI, in the units a human thinks in. */
export const BETA_WINDOW_LABEL = '1Y';
/**
 * Below this many aligned sessions the answer is the dash. A beta taken from a handful of days is
 * dominated by whichever single session moved most, and the card would present it as a one-year
 * measurement — measured on 2026-09-27, 66 of 508 tracked symbols sit under this line (a symbol
 * listed weeks ago has no year of history to measure), and every one of them reads `—`.
 */
export const BETA_MIN_OBSERVATIONS = 60;
/** How the number was obtained, stated on the payload rather than assumed by the reader. */
export const BETA_METHOD =
  'beta = cov(daily log return of the stock, daily log return of the KSE-100) / '
  + 'var(daily log return of the KSE-100), over the aligned sessions of the window below';

/** One session of the window: the index close, and the symbol's own when it traded one. */
export interface BetaSample {
  /** Exchange session day, `YYYY-MM-DD`. */
  day: string;
  stockClose: number | null;
  indexClose: number | null;
}

/** What the value was computed from — reported beside it, never implied. */
export interface BetaWindow {
  /** Index the beta is measured against. */
  index: string;
  /** The window in human units: one trading year. */
  label: string;
  /** The window's length in index sessions. */
  sessions: number;
  /** Aligned sessions actually used (the sample size, one per return). */
  observations: number;
  /** First and last session day a return was taken on, `YYYY-MM-DD`; null when there are none. */
  from: string | null;
  to: string | null;
  /** The floor below which no value is served. */
  minimum: number;
}

export interface BetaResult {
  /** Rounded to the stored column's precision (4dp). Null means "not measurable" — a dash. */
  value: number | null;
  window: BetaWindow;
  method: string;
  /** Why `value` is null, in words a UI can show. Null when a value was computed. */
  reason: string | null;
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Sample covariance (n-1), which is what makes the ratio below the OLS slope. */
function covariance(a: number[], b: number[], meanA: number, meanB: number): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i]! - meanA) * (b[i]! - meanB);
  return sum / (a.length - 1);
}

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Pure beta over an aligned window — no database, so it is unit-testable against a hand
 * calculation (tests/beta.test.ts).
 *
 * `samples` are the window's index sessions, oldest first, and each one is a session the exchange
 * held. A sample whose `stockClose` is null is a session the symbol has no close for; the pair of
 * samples straddling it yields no return, and neither does a pair whose index close is missing.
 * Returns are logarithmic, which is the convention for a beta measured over daily bars.
 */
export function computeBeta(
  samples: BetaSample[],
  opts: { index?: string; sessions?: number; minimum?: number } = {},
): BetaResult {
  const index = opts.index ?? BETA_INDEX_SYMBOL;
  const sessions = opts.sessions ?? BETA_WINDOW_SESSIONS;
  const minimum = opts.minimum ?? BETA_MIN_OBSERVATIONS;

  const rStock: number[] = [];
  const rIndex: number[] = [];
  let from: string | null = null;
  let to: string | null = null;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    // Both legs need a close on *both* sessions of the pair: aligned days, adjacent sessions, and
    // no carrying a value across a gap.
    if (prev.stockClose == null || cur.stockClose == null) continue;
    if (prev.indexClose == null || cur.indexClose == null) continue;
    // A close of zero or below is not a price; it would make the log return infinite.
    if (prev.stockClose <= 0 || cur.stockClose <= 0) continue;
    if (prev.indexClose <= 0 || cur.indexClose <= 0) continue;
    rStock.push(Math.log(cur.stockClose / prev.stockClose));
    rIndex.push(Math.log(cur.indexClose / prev.indexClose));
    if (from === null) from = prev.day;
    to = cur.day;
  }

  const window: BetaWindow = {
    index,
    label: BETA_WINDOW_LABEL,
    sessions,
    observations: rStock.length,
    from,
    to,
    minimum,
  };
  const base = { window, method: BETA_METHOD };

  if (rStock.length < minimum) {
    return {
      ...base,
      value: null,
      reason: rStock.length === 0
        ? `no session in the last ${sessions} ${index} sessions has a close for both the symbol and the index`
        : `only ${rStock.length} aligned session(s) in the last ${sessions} ${index} sessions; `
          + `${minimum} are required for a one-year beta`,
    };
  }

  const meanStock = mean(rStock);
  const meanIndex = mean(rIndex);
  const varianceIndex = covariance(rIndex, rIndex, meanIndex, meanIndex);
  // A genuinely flat index over the window has no variation to explain: beta is undefined, and
  // returning 0 would read as "moves exactly with the market".
  if (!(varianceIndex > 0)) {
    return { ...base, value: null, reason: `the ${index} showed no variation over the window` };
  }

  const beta = covariance(rStock, rIndex, meanStock, meanIndex) / varianceIndex;
  if (!Number.isFinite(beta)) {
    return { ...base, value: null, reason: 'beta is not a finite number over this window' };
  }
  return { ...base, value: round4(beta), reason: null };
}

/** What a refresh pass did, symbol by symbol. Counts, so a thin window is visible. */
export interface BetaRefreshSummary {
  tracked: number;
  /** Symbols a value was computed for. */
  computed: number;
  /** Symbols left as a dash, with the reason. */
  belowMinimum: { symbol: string; observations: number; reason: string }[];
  /** What happened to the stored column per symbol. */
  written: Record<BetaWriteOutcome, number>;
}

export const betaService = {
  /**
   * Beta for one symbol, computed from what we hold — the read path's answer, with its window.
   * Never throws for thin data: a symbol without enough aligned sessions comes back as a dash
   * carrying the reason.
   */
  async forSymbol(symbol: string): Promise<BetaResult> {
    const rows = await fetchBetaSeries(symbol.toUpperCase(), BETA_WINDOW_SESSIONS, BETA_INDEX_SYMBOL);
    return computeBeta(rows, {
      index: BETA_INDEX_SYMBOL,
      sessions: BETA_WINDOW_SESSIONS,
      minimum: BETA_MIN_OBSERVATIONS,
    });
  },

  /** Compute and store: what every write goes through, so `ratios.beta` is never a borrowed value. */
  async refreshSymbol(symbol: string): Promise<BetaResult & { stored: BetaWriteOutcome }> {
    const result = await betaService.forSymbol(symbol);
    const stored = await recordBeta(symbol, result.value);
    return { ...result, stored };
  },

  /**
   * Recompute and store beta for every tracked symbol. Local computation only — no source is
   * asked for anything, so there is no request budget to pace and no refusal to back off from.
   * Used by `scripts/refresh-beta.ts` and the on-demand endpoint that fills the column.
   */
  async refreshAll(): Promise<BetaRefreshSummary> {
    const symbols = await stockRepository.findAllSymbols();
    const log = childLogger({ op: 'beta.refresh_all' });
    const summary: BetaRefreshSummary = {
      tracked: symbols.length,
      computed: 0,
      belowMinimum: [],
      written: { updated: 0, created: 0, skipped: 0 },
    };

    for (const symbol of symbols) {
      try {
        const { value, window, stored, reason } = await betaService.refreshSymbol(symbol);
        summary.written[stored] += 1;
        if (value === null) {
          summary.belowMinimum.push({ symbol, observations: window.observations, reason: reason ?? 'not measurable' });
        } else {
          summary.computed += 1;
        }
      } catch (err) {
        // One symbol's failure must not abandon the pass: report it as below-minimum-with-a-reason
        // (the column keeps what it held) and keep walking.
        summary.belowMinimum.push({
          symbol,
          observations: 0,
          reason: `refresh failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    log.info('beta.refresh_all_done', {
      tracked: summary.tracked,
      computed: summary.computed,
      belowMinimum: summary.belowMinimum.length,
      ...summary.written,
    });
    return summary;
  },
};
