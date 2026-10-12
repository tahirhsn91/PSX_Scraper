import type { Trend } from './format';

/** The direction of a whole series, and the readings that decide it. */
export interface SeriesTrend {
  trend: Trend;
  /** First and last readings in the window — the reference the direction is measured from. */
  first: number;
  last: number;
  /** Absolute move, `last - first`. */
  change: number;
  /** Move as a percentage of the first reading. */
  changePercent: number;
}

/**
 * Float noise, not a percentage band. `trendOf` treats anything inside ±0.05% as flat, which is
 * right for a single day's quoted move but wrong here: over a window the reader has chosen, a
 * +0.03% move is a real gain, and painting it grey reads as broken. Only a series that
 * mathematically did not move is neutral.
 */
const NOISE = 1e-9;

/**
 * Where a series ended relative to where it started — the direction a whole-chart treatment is
 * toned by, as opposed to `trendOf`, which reads one quoted change.
 *
 * Reads the same values the chart draws, in the same order, so the tone can never describe a
 * different window than the line does. Returns null when there is nothing to compare: a window
 * with fewer than two readings has no direction, and guessing one would be a claim about data we
 * do not have.
 */
export function seriesTrend(values: (number | null | undefined)[]): SeriesTrend | null {
  const clean = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (clean.length < 2) return null;

  const first = clean[0];
  const last = clean[clean.length - 1];
  const change = last - first;
  // A series that starts at zero has no meaningful percentage; the absolute move still decides.
  const ratio = first === 0 ? change : change / first;

  let trend: Trend;
  if (Math.abs(ratio) < NOISE) trend = 'flat';
  else trend = ratio > 0 ? 'up' : 'down';

  return { trend, first, last, change, changePercent: ratio * 100 };
}
