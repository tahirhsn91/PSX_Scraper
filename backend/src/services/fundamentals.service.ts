/**
 * Fundamental scoring behind the Performance Insights panel.
 *
 * ## Why this replaced the binary test
 *
 * The first version judged every metric "beats the benchmark and the sector median" and paid
 * 1 / 0.5 / 0 for it. Three problems showed up once it ran on the whole board:
 *
 *  - scores could only be multiples of 100/13, so hundreds of stocks landed on 0, 8, 15, 23…
 *  - one industry-blind benchmark could fail a whole sector — commercial banks always carry D/E
 *    far above 1 and publish no current ratio, so a strong bank could score single digits;
 *  - two published ratios (P/E and P/B) were enough to produce a "performance" score.
 *
 * ## What it does now
 *
 * 1. Each metric becomes 0–100 from a published curve (ROE 0 → 0, 25% → 100, and so on).
 * 2. That is blended 50/50 with the stock's percentile among peers when at least 8 peers publish
 *    the metric — a bank is judged against banks, but a whole weak sector cannot lift itself.
 * 3. Metrics roll up into five pillars. Metrics that do not apply to a sector are skipped, never
 *    failed (banks: no D/E, no current ratio, no ROIC).
 * 4. Pillars are weighted into a current and a forward view; the overall score is their mean.
 * 5. A score needs at least 4 metrics across 2 pillars, otherwise it is `null` — a dash, not a guess.
 * 6. Loss-makers and negative-equity companies are capped, so a company reporting a loss can never
 *    read "Strong" however cheap its ratios look.
 */

export type Pillar = 'profitability' | 'growth' | 'valuation' | 'health' | 'income';

export const PILLAR_LABELS: Record<Pillar, string> = {
  profitability: 'Profitability',
  growth: 'Growth',
  valuation: 'Valuation',
  health: 'Financial health',
  income: 'Dividend',
};

export type Unit = 'rs' | 'pct' | 'x';

export interface MetricRule {
  /** The ratio field this metric reads. */
  key: string;
  label: string;
  pillar: Pillar;
  unit: Unit;
  /** 0–100 for a published value. */
  curve: (value: number) => number;
  /** Metrics a financial company does not meaningfully report. */
  financialOnly?: 'skip';
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** 0 at `zero`, 100 at `full`, linear and clamped in between (higher is better). */
const scaleUp = (v: number, zero: number, full: number) => clamp(((v - zero) / (full - zero)) * 100);

/** 100 at or below `best`, 0 at or above `worst` (lower is better). */
const scaleDown = (v: number, best: number, worst: number) => clamp(((worst - v) / (worst - best)) * 100);

/** 100 inside the band, falling to 0 at either edge. */
const band = (v: number, goodLo: number, goodHi: number, zeroLo: number, zeroHi: number) =>
  v < goodLo ? scaleUp(v, zeroLo, goodLo) : v > goodHi ? scaleDown(v, goodHi, zeroHi) : 100;

/**
 * The scored metrics. Rupee amounts (EPS, book value, DPS) are *not* scored on level — a 5 rupee EPS
 * is not comparable with a 300 rupee one — they are used as solvency gates below instead.
 */
export const METRIC_RULES: MetricRule[] = [
  { key: 'roe', label: 'ROE', pillar: 'profitability', unit: 'pct', curve: (v) => scaleUp(v, 0, 25) },
  { key: 'roa', label: 'ROA', pillar: 'profitability', unit: 'pct', curve: (v) => scaleUp(v, 0, 15) },
  {
    key: 'netProfitMargin', label: 'Net margin', pillar: 'profitability', unit: 'pct',
    curve: (v) => scaleUp(v, 0, 25),
  },
  {
    key: 'roic', label: 'ROIC', pillar: 'profitability', unit: 'pct',
    curve: (v) => scaleUp(v, 0, 20), financialOnly: 'skip',
  },
  {
    key: 'peRatio', label: 'P/E', pillar: 'valuation', unit: 'x',
    // A loss-maker has no meaningful P/E; the solvency gate handles it, so clamp at zero here.
    curve: (v) => (v <= 0 ? 0 : scaleDown(v, 8, 35)),
  },
  { key: 'pbRatio', label: 'P/B', pillar: 'valuation', unit: 'x', curve: (v) => (v < 0 ? 0 : scaleDown(v, 1, 6)) },
  { key: 'dividendYield', label: 'Dividend yield', pillar: 'income', unit: 'pct', curve: (v) => scaleUp(v, 0, 9) },
  { key: 'payoutRatio', label: 'Payout ratio', pillar: 'income', unit: 'pct', curve: (v) => band(v, 25, 60, 0, 95) },
  { key: 'revenueGrowth', label: 'Revenue growth', pillar: 'growth', unit: 'pct', curve: (v) => scaleUp(v, -10, 30) },
  { key: 'epsGrowth', label: 'EPS growth', pillar: 'growth', unit: 'pct', curve: (v) => scaleUp(v, -20, 40) },
  {
    key: 'debtToEquity', label: 'D/E', pillar: 'health', unit: 'x',
    curve: (v) => (v < 0 ? 0 : scaleDown(v, 0.3, 2.5)),
    financialOnly: 'skip',
  },
  {
    key: 'currentRatio', label: 'Current ratio', pillar: 'health', unit: 'x',
    curve: (v) => scaleUp(v, 0.8, 2.5), financialOnly: 'skip',
  },
];

/** Sectors whose balance sheet makes leverage and liquidity ratios meaningless. */
const FINANCIAL_SECTORS = new Set([
  'COMMERCIAL BANKS',
  'INSURANCE',
  'INV. BANKS / INV. COS. / SECURITIES COS.',
  'MODARABAS',
  'LEASING COMPANIES',
  'MUTUAL FUNDS',
]);

export const isFinancialSector = (sector: string) => FINANCIAL_SECTORS.has(sector.toUpperCase());

/** Weights. The current view asks "how is it doing now"; the forward view how it may develop. */
export const CURRENT_WEIGHTS: Record<Pillar, number> = {
  profitability: 0.45,
  valuation: 0.3,
  income: 0.15,
  health: 0.1,
  growth: 0,
};
export const FUTURE_WEIGHTS: Record<Pillar, number> = {
  growth: 0.6,
  profitability: 0.4,
  valuation: 0,
  income: 0,
  health: 0,
};

/** A metric needs this many peer values before its percentile is worth using. */
export const MIN_PEERS = 8;

export type RatioMap = Record<string, number | null | undefined>;

/** Peer distributions for one sector: each metric's published values, sorted ascending. */
export type Distributions = Record<string, number[]>;

export interface PeerStats {
  sector: string;
  distributions: Distributions;
}

/**
 * Build the peer distributions a sector is scored against. Pure, so the maths is testable without
 * a database; `detailCache` caches the result per sector.
 */
export function peerStatsOf(sector: string, rows: RatioMap[]): PeerStats {
  const distributions: Distributions = {};
  for (const rule of METRIC_RULES) {
    const values = rows
      .map((row) => row[rule.key])
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (values.length > 0) distributions[rule.key] = values;
  }
  return { sector, distributions };
}

/** Percentile of `value` among `sorted` (0–100), or null when there are too few peers. */
export function percentileOf(value: number, sorted: number[] | undefined): number | null {
  if (!sorted || sorted.length < MIN_PEERS) return null;
  let below = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else break;
  }
  return (below / (sorted.length - 1)) * 100;
}

export interface MetricScore {
  key: string;
  label: string;
  pillar: Pillar;
  value: number;
  score: number;
}

/** Score one stock against its peers. Skips metrics that are absent or do not apply. */
export function metricScores(ratios: RatioMap, peer: PeerStats): MetricScore[] {
  const financial = isFinancialSector(peer.sector);
  const out: MetricScore[] = [];
  for (const rule of METRIC_RULES) {
    if (financial && rule.financialOnly === 'skip') continue;
    const value = ratios[rule.key];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const absolute = clamp(rule.curve(value));
    const pct = percentileOf(value, peer.distributions[rule.key]);
    out.push({
      key: rule.key,
      label: rule.label,
      pillar: rule.pillar,
      value,
      // Half the call is absolute quality, half is standing among peers.
      score: pct === null ? absolute : 0.5 * absolute + 0.5 * pct,
    });
  }
  return out;
}

/** Mean score per pillar, over the pillars that have at least one metric. */
export function pillarScores(scores: MetricScore[]): Partial<Record<Pillar, number>> {
  const sums: Partial<Record<Pillar, { total: number; n: number }>> = {};
  for (const s of scores) {
    const acc = (sums[s.pillar] ??= { total: 0, n: 0 });
    acc.total += s.score;
    acc.n += 1;
  }
  const out: Partial<Record<Pillar, number>> = {};
  for (const [pillar, acc] of Object.entries(sums) as [Pillar, { total: number; n: number }][]) {
    out[pillar] = acc.total / acc.n;
  }
  return out;
}

/** Weighted mean over the pillars present, renormalised so a missing pillar is not a penalty. */
function weighted(pillars: Partial<Record<Pillar, number>>, weights: Record<Pillar, number>): number | null {
  let total = 0;
  let weight = 0;
  for (const [pillar, score] of Object.entries(pillars) as [Pillar, number][]) {
    const w = weights[pillar];
    if (!w) continue;
    total += score * w;
    weight += w;
  }
  return weight === 0 ? null : total / weight;
}

export type Verdict = 'strong' | 'fair' | 'weak';
export type Outlook = 'positive' | 'neutral' | 'cautious';

export function verdictOf(score: number | null): Verdict | null {
  if (score === null) return null;
  if (score >= 67) return 'strong';
  if (score >= 34) return 'fair';
  return 'weak';
}

export function outlookOf(score: number | null): Outlook | null {
  if (score === null) return null;
  if (score >= 67) return 'positive';
  if (score >= 34) return 'neutral';
  return 'cautious';
}

/** A company reporting a loss, or with negative equity, cannot be rated Strong however cheap it looks. */
export const LOSS_CAP = 49;
export const NEGATIVE_EQUITY_CAP = 34;

export interface PillarScore {
  key: Pillar;
  label: string;
  score: number;
}

export interface FundamentalsInsights {
  overall: number | null;
  verdict: Verdict | null;
  current: { score: number | null; assessed: number };
  future: { score: number | null; assessed: number; fallback: boolean };
  outlook: Outlook | null;
  /** Pillar scores in a fixed display order; only the pillars with data. */
  pillars: PillarScore[];
  /** Metrics scored vs metrics that apply to this sector — the reader's confidence signal. */
  coverage: { scored: number; applicable: number };
  /** Set when the score was held down by a loss or negative equity. */
  capped: 'loss' | 'negative-equity' | null;
}

const PILLAR_ORDER: Pillar[] = ['profitability', 'growth', 'valuation', 'health', 'income'];

/** Minimum evidence before any score is published. */
export const MIN_METRICS = 4;
export const MIN_PILLARS = 2;

export function scoreFundamentals(ratios: RatioMap, peer: PeerStats): FundamentalsInsights {
  const financial = isFinancialSector(peer.sector);
  const scores = metricScores(ratios, peer);
  const pillars = pillarScores(scores);

  const applicable = METRIC_RULES.filter((r) => !(financial && r.financialOnly === 'skip')).length;
  const coverage = { scored: scores.length, applicable };
  const enough = scores.length >= MIN_METRICS && Object.keys(pillars).length >= MIN_PILLARS;

  const currentRaw = enough ? weighted(pillars, CURRENT_WEIGHTS) : null;
  const futureRaw = enough ? weighted(pillars, FUTURE_WEIGHTS) : null;

  const eps = ratios.eps;
  const book = ratios.bookValue;
  const loss = eps !== null && eps !== undefined && Number.isFinite(eps) && eps < 0;
  const negativeEquity = book !== null && book !== undefined && Number.isFinite(book) && book < 0;
  const cap = negativeEquity ? NEGATIVE_EQUITY_CAP : loss ? LOSS_CAP : null;

  const applyCap = (v: number | null) => (v === null || cap === null ? v : Math.min(v, cap));
  const currentCapped = applyCap(currentRaw);
  const current = currentCapped === null ? null : Math.round(currentCapped);

  // The forward view falls back to the current view when no growth series is published — flagged,
  // so the panel can say so instead of implying a growth forecast that does not exist.
  const fallback = currentRaw !== null && pillars.growth === undefined;
  const futureRawFinal = fallback ? currentRaw : futureRaw ?? currentRaw;
  const futureCapped = applyCap(futureRawFinal);
  const future = futureCapped === null ? null : Math.round(futureCapped);

  const parts = [current, future].filter((v): v is number => v !== null);
  const overall = parts.length === 0 ? null : Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);

  // Only report a cap when it actually held the score down; a company scoring 17 on its own merits
  // should not be told it was capped.
  const rawParts = [currentRaw, futureRawFinal].filter((v): v is number => v !== null);
  const rawOverall = rawParts.length === 0 ? null : rawParts.reduce((a, b) => a + b, 0) / rawParts.length;
  const capped = cap !== null && overall !== null && rawOverall !== null && rawOverall > overall
    ? negativeEquity
      ? 'negative-equity'
      : 'loss'
    : null;

  return {
    overall,
    verdict: verdictOf(overall),
    current: { score: current, assessed: scores.length },
    future: {
      score: future,
      assessed: scores.filter((s) => FUTURE_WEIGHTS[s.pillar] > 0).length,
      fallback,
    },
    outlook: outlookOf(future),
    pillars: PILLAR_ORDER.filter((p) => pillars[p] !== undefined).map((p) => ({
      key: p,
      label: PILLAR_LABELS[p],
      score: Math.round(pillars[p]!),
    })),
    coverage,
    capped,
  };
}

/** Median of a numeric list, or null when empty. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
