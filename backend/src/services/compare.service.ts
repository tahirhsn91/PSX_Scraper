import { prisma } from '../database/prisma';
import { NotFoundError } from '../types/errors';

/**
 * Normalised comparison of two to five symbols.
 *
 * The single rule that makes a comparison meaningful: **every line starts at 100 on the same date**,
 * and that date is the first session *all* the symbols share. A symbol with no overlapping history
 * is reported as excluded rather than dropped — silently returning three lines when the reader asked
 * for four is the kind of omission that changes the conclusion.
 *
 * Volatility is the annualised standard deviation of daily log returns; maximum drawdown is the
 * deepest peak-to-trough fall inside the window. Both are descriptive statistics of the past, not
 * forecasts, and both are computed on the same aligned window as the chart.
 */

export const COMPARE_PERIODS = {
  '1m': 21,
  '3m': 63,
  '6m': 126,
  '1y': 252,
  '3y': 756,
} as const;

export type ComparePeriod = keyof typeof COMPARE_PERIODS;

export interface CompareSeries {
  symbol: string;
  name: string | null;
  points: { date: string; value: number }[];
  /** Return over the aligned window, in percent. */
  returnPct: number;
  /** Annualised stdev of daily log returns, in percent. */
  volatilityPct: number;
  /** Deepest peak-to-trough fall in the window, as a positive percent. */
  maxDrawdownPct: number;
  sessions: number;
}

export interface CompareResult {
  period: ComparePeriod;
  windowStart: string | null;
  windowEnd: string | null;
  series: CompareSeries[];
  excluded: { symbol: string; reason: string }[];
  /**
   * Symbols whose history is shorter than the longest line, so the reader knows which one set the
   * window. Empty when every symbol covers the full period.
   */
  shortenedBy: { symbol: string; sessions: number }[];
}

interface Row {
  symbol: string;
  name: string | null;
  d: string;
  close: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
};

const drawdown = (values: number[]): number => {
  let peak = values[0] ?? 0;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
  }
  return worst * 100;
};

export async function compare(symbols: string[], period: ComparePeriod): Promise<CompareResult> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (wanted.length < 2) throw new NotFoundError('Compare needs at least two symbols');

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `
    SELECT s.symbol, s.company_name AS name, per_day.d::text AS d, per_day.close
    FROM stocks s
    JOIN LATERAL (
      -- Take the *latest* N sessions, then hand them back oldest-first. Ordering ascending before
      -- LIMIT would take the first N sessions the symbol ever had (a 2016 window for a 2026 chart).
      SELECT * FROM (
        SELECT d, close FROM (
          SELECT DISTINCT ON (last_trade_date::date)
            last_trade_date::date AS d, close
          FROM stock_prices
          WHERE stock_id = s.id AND close IS NOT NULL
          ORDER BY last_trade_date::date DESC, last_trade_date DESC
        ) per_day_inner
        ORDER BY d DESC
        LIMIT $2
      ) recent
      ORDER BY d ASC
    ) per_day ON TRUE
    WHERE s.symbol = ANY($1)
    ORDER BY s.symbol, per_day.d ASC
    `,
    wanted,
    COMPARE_PERIODS[period] + 1,
  );

  const bySymbol = new Map<string, { name: string | null; series: Map<string, number> }>();
  const known = new Set<string>();
  for (const r of rows) {
    known.add(r.symbol);
    let entry = bySymbol.get(r.symbol);
    if (!entry) {
      entry = { name: r.name, series: new Map() };
      bySymbol.set(r.symbol, entry);
    }
    entry.series.set(r.d, Number(r.close));
  }

  const excluded: { symbol: string; reason: string }[] = wanted
    .filter((s) => !known.has(s))
    .map((s) => ({ symbol: s, reason: 'not tracked, or no stored sessions' }));

  const usable = [...bySymbol.entries()].filter(([, v]) => v.series.size > 1);
  for (const [symbol, v] of bySymbol) {
    if (v.series.size <= 1) excluded.push({ symbol, reason: 'not enough sessions to compare' });
  }

  // The common window: dates present for *every* usable symbol, oldest first.
  const common = usable.length
    ? [...(usable[0]?.[1].series.keys() ?? [])]
        .filter((d) => usable.every(([, v]) => v.series.has(d)))
        .sort()
    : [];

  if (usable.length < 2 || common.length < 2) {
    return {
      period,
      windowStart: null,
      windowEnd: null,
      series: [],
      shortenedBy: [],
      excluded: [
        ...excluded,
        ...usable.map(([symbol]) => ({
          symbol,
          reason: 'no overlapping history with the other symbols',
        })),
      ],
    };
  }

  const firstDate = common[0] as string;
  const lastDate = common[common.length - 1] as string;
  const series: CompareSeries[] = usable.map(([symbol, v]) => {
    const base = v.series.get(firstDate) as number;
    const values = common.map((d) => v.series.get(d) as number);
    const points = common.map((d, i) => ({ date: d, value: ((values[i] as number) / base) * 100 }));
    const logReturns = values.slice(1).map((x, i) => Math.log(x / (values[i] as number)));
    return {
      symbol,
      name: v.name,
      points,
      returnPct: ((values[values.length - 1] as number) / base - 1) * 100,
      volatilityPct: stdev(logReturns) * Math.sqrt(252) * 100,
      maxDrawdownPct: drawdown(values),
      sessions: common.length,
    };
  });

  // Which symbol pulled the window shorter than the requested period.
  const longest = Math.max(...usable.map(([, v]) => v.series.size));
  const shortenedBy = usable
    .filter(([, v]) => v.series.size < longest)
    .map(([symbol, v]) => ({ symbol, sessions: v.series.size }));

  return {
    period,
    shortenedBy,
    windowStart: firstDate,
    windowEnd: lastDate,
    series: series.sort((a, b) => b.returnPct - a.returnPct),
    excluded,
  };
}
