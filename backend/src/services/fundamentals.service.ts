/**
 * Fundamental-analysis scoring for the Stock Details page (issue #131).
 *
 * Each of the 17 metrics is judged **two ways** and the two are combined: against the median of the
 * stocks in the same sector, and against a fixed benchmark. A metric earns full credit for beating
 * both, half credit for beating one, and none for beating neither; a metric the source did not
 * publish is excluded from both the numerator and the denominator (it is a dash, not a zero).
 *
 * The sub-scores and the rubric are deliberately pure and exported for tests: the "math shown, not
 * just the verdict" acceptance criterion is met by unit-testing `scoreFundamentals` against a known
 * stock's numbers, while the median query lives in `fundamentals.repository.ts`.
 */

export type Direction = 'higher' | 'lower' | 'range' | 'neutral';

export interface MetricSpec {
  /** The `RatioDTO` field this metric reads. */
  key: string;
  label: string;
  /** How a value is judged: higher-better, lower-better, inside a band, or informational only. */
  direction: Direction;
  /** Fixed benchmark lower bound (>= for `higher`, <= for `lower`, >= for `range`). Null for neutral. */
  benchmark: number | null;
  /** Upper bound for `range` metrics (payout ratio 20–70). */
  benchmarkHigh?: number;
  /** Display unit, so the tooltip and the tile agree. */
  unit: 'rs' | 'pct' | 'x' | 'shares';
}

/**
 * The 17 metrics in the Fundamentals section. Fixed benchmarks are the proposal recorded in the
 * issue (ROE >= 15, ROA >= 5, ROIC >= 10, net margin >= 10, D/E <= 1, current ratio >= 1.5,
 * P/E <= 20, P/B <= 3, dividend yield >= 4, payout 20–70, revenue/EPS growth >= 10, and a positive
 * EPS / book value / DPS) — confirm in review.
 */
export const FUNDAMENTAL_METRICS: MetricSpec[] = [
  { key: 'eps', label: 'EPS', direction: 'higher', benchmark: 0, unit: 'rs' },
  { key: 'peRatio', label: 'P/E', direction: 'lower', benchmark: 20, unit: 'x' },
  { key: 'bookValue', label: 'Book Value / Share', direction: 'higher', benchmark: 0, unit: 'rs' },
  { key: 'pbRatio', label: 'P/B', direction: 'lower', benchmark: 3, unit: 'x' },
  { key: 'dividendYield', label: 'Dividend Yield', direction: 'higher', benchmark: 4, unit: 'pct' },
  { key: 'dps', label: 'DPS', direction: 'higher', benchmark: 0, unit: 'rs' },
  { key: 'payoutRatio', label: 'Payout Ratio', direction: 'range', benchmark: 20, benchmarkHigh: 70, unit: 'pct' },
  { key: 'roe', label: 'ROE', direction: 'higher', benchmark: 15, unit: 'pct' },
  { key: 'roa', label: 'ROA', direction: 'higher', benchmark: 5, unit: 'pct' },
  { key: 'roic', label: 'ROIC', direction: 'higher', benchmark: 10, unit: 'pct' },
  { key: 'debtToEquity', label: 'D/E', direction: 'lower', benchmark: 1, unit: 'x' },
  { key: 'currentRatio', label: 'Current Ratio', direction: 'higher', benchmark: 1.5, unit: 'x' },
  { key: 'netProfitMargin', label: 'Net Profit Margin', direction: 'higher', benchmark: 10, unit: 'pct' },
  { key: 'revenueGrowth', label: 'Revenue Growth', direction: 'higher', benchmark: 10, unit: 'pct' },
  { key: 'epsGrowth', label: 'EPS Growth', direction: 'higher', benchmark: 10, unit: 'pct' },
  { key: 'freeFloatShares', label: 'Free Float Share', direction: 'neutral', benchmark: null, unit: 'shares' },
  { key: 'freeFloatPercent', label: 'Free Float Share %', direction: 'neutral', benchmark: null, unit: 'pct' },
];

const SPEC = new Map(FUNDAMENTAL_METRICS.map((m) => [m.key, m]));

/** Metrics scored for *current* performance: profitability, valuation, per-share, leverage, liquidity, dividend. */
export const CURRENT_KEYS = [
  'eps', 'peRatio', 'bookValue', 'pbRatio', 'dividendYield', 'dps', 'payoutRatio',
  'roe', 'roa', 'roic', 'debtToEquity', 'currentRatio', 'netProfitMargin',
];

/**
 * Metrics scored for *future* performance: growth plus the leverage that either funds or blocks it.
 * `debtToEquity` appears in both groups on purpose — it is a balance-sheet state (current) and the
 * "leverage direction" the issue names for the forward view.
 */
export const FUTURE_KEYS = ['revenueGrowth', 'epsGrowth', 'debtToEquity'];

/** A sector-median map: metric key -> median, or null when no peer publishes the metric. */
export type SectorMedians = Record<string, number | null>;

/**
 * Whether a value beats its fixed benchmark.
 *
 * `lower` benchmarks treat a negative value as *not* beating (a negative P/E or P/B is a loss /
 * negative equity, not a bargain); `range` benchmarks are a closed band.
 */
function beatsBenchmark(value: number, spec: MetricSpec): boolean {
  if (spec.direction === 'neutral') return false;
  if (spec.direction === 'higher') return value >= (spec.benchmark ?? 0);
  if (spec.direction === 'lower') return value >= 0 && value <= (spec.benchmark ?? 0);
  // range
  const high = spec.benchmarkHigh ?? spec.benchmark ?? 0;
  return value >= (spec.benchmark ?? 0) && value <= high;
}

/** Whether a value beats the sector median, in the metric's direction. */
function beatsMedian(value: number, median: number | null, spec: MetricSpec): boolean {
  if (median === null || spec.direction === 'neutral') return false;
  if (spec.direction === 'range') return value >= (spec.benchmark ?? 0) && value <= (spec.benchmarkHigh ?? spec.benchmark ?? 0);
  if (spec.direction === 'higher') return value >= median;
  return value >= 0 && value <= median; // lower
}

/** Credit for one metric: 1 (both), 0.5 (one), 0 (neither), or null (excluded — no value). */
export function metricCredit(
  key: string,
  value: number | null | undefined,
  median: number | null | undefined,
): number | null {
  const spec = SPEC.get(key);
  if (!spec || spec.direction === 'neutral') return null;
  if (value === null || value === undefined) return null;
  // A `range` metric has only the benchmark band as a signal — there is no meaningful "median" to
  // beat for "payout ratio inside 20–70".
  if (spec.direction === 'range') {
    return beatsBenchmark(value, spec) ? 1 : 0;
  }
  const b = beatsBenchmark(value, spec);
  const m = beatsMedian(value, median ?? null, spec);
  if (b && m) return 1;
  if (b || m) return 0.5;
  return 0;
}

/** Mean credit -> 0–100, rounding to the nearest integer. Excludes unassessed metrics. */
function subScore(keys: string[], ratios: Record<string, number | null | undefined>, medians: SectorMedians) {
  let sum = 0;
  let assessed = 0;
  for (const key of keys) {
    const credit = metricCredit(key, ratios[key], medians[key]);
    if (credit === null) continue;
    sum += credit;
    assessed += 1;
  }
  const score = assessed === 0 ? null : Math.round((sum / assessed) * 100);
  return { score, assessed };
}

export interface FundamentalsInsights {
  /** 0–100, the mean of the current and future sub-scores (only when at least one metric was assessed). */
  overall: number | null;
  /** Qualitative label for the overall score. */
  verdict: 'strong' | 'fair' | 'weak' | null;
  current: { score: number | null; assessed: number };
  future: { score: number | null; assessed: number };
  /** The Future Outlook verdict, derived from the future sub-score alone. */
  outlook: 'positive' | 'neutral' | 'cautious' | null;
}

/** A qualitative label from a 0–100 score. */
export function verdictOf(score: number | null): 'strong' | 'fair' | 'weak' | null {
  if (score === null) return null;
  if (score >= 67) return 'strong';
  if (score >= 34) return 'fair';
  return 'weak';
}

export function outlookOf(score: number | null): 'positive' | 'neutral' | 'cautious' | null {
  if (score === null) return null;
  if (score >= 67) return 'positive';
  if (score >= 34) return 'neutral';
  return 'cautious';
}

/**
 * Score a stock's ratios against its sector's medians and the fixed benchmarks.
 *
 * `ratios` is the flat numeric map the API already serves (each metric null when unpublished);
 * `medians` is the same shape with each sector median, or null when no peer publishes it.
 */
export function scoreFundamentals(
  ratios: Record<string, number | null | undefined>,
  medians: SectorMedians,
): FundamentalsInsights {
  const current = subScore(CURRENT_KEYS, ratios, medians);
  const future = subScore(FUTURE_KEYS, ratios, medians);

  let overall: number | null = null;
  if (current.score !== null && future.score !== null) {
    overall = Math.round((current.score + future.score) / 2);
  } else if (current.score !== null) {
    overall = current.score;
  } else if (future.score !== null) {
    overall = future.score;
  }

  return {
    overall,
    verdict: verdictOf(overall),
    current,
    future,
    outlook: outlookOf(future.score),
  };
}

/** The median of a list of numbers, or null when the list is empty. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Compute per-metric medians from a list of one-row-per-stock ratio objects (already filtered to a
 * sector). Pure so the median maths can be tested without the database.
 */
export function mediansOf(rows: Array<Record<string, number | null | undefined>>): SectorMedians {
  const out: SectorMedians = {};
  for (const spec of FUNDAMENTAL_METRICS) {
    const values: number[] = [];
    for (const row of rows) {
      const v = row[spec.key];
      if (v !== null && v !== undefined) values.push(v);
    }
    out[spec.key] = medianOf(values);
  }
  return out;
}
