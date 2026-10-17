/**
 * Technical indicators, hand-rolled.
 *
 * Deliberate constraints:
 *
 * - **No dependency.** Every formula here is a few lines, and a TA library would add a supply-chain
 *   surface and its own opinions about warm-up periods for something this small.
 * - **Warm-up is explicit.** An indicator returns `null` until its window is genuinely full — never
 *   a value computed from three of the twenty sessions it claims to average. A short history is the
 *   normal case for this dataset, so the nulls are the honest output, not an edge case.
 * - **Every series says what it is.** `params` and the window actually used travel with the values,
 *   so a chart can label "RSI(14)" without guessing and a reader can see which sessions produced it.
 *
 * Conventions worth stating because implementations differ:
 *
 * - SMA uses the last `n` closes, inclusive of the current one.
 * - RSI is Wilder's smoothing (not a simple average of the last n gains/losses), seeded with the
 *   mean of the first `n` changes.
 * - MACD is EMA(12) − EMA(26); the signal line is an EMA(9) *of that difference*, not of price.
 * - Bollinger uses the **population** standard deviation over the window.
 * - ATR uses Wilder smoothing on true range, whose first value is the mean of `n` true ranges.
 * - Relative volume compares today's volume with the mean of the **previous** `n` sessions —
 *   excluding today, so a huge day does not dilute the baseline it is measured against.
 */

export interface CandleLike {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export type Line = Array<number | null>;

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Mean of `values[i-n+1..i]`, or null when any of them is missing. */
function windowMean(values: Array<number | null>, i: number, n: number): number | null {
  if (i < n - 1) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const v = values[k];
    if (!isNum(v)) return null;
    sum += v;
  }
  return sum / n;
}

export function sma(values: Array<number | null>, n: number): Line {
  return values.map((_, i) => windowMean(values, i, n));
}

/**
 * Exponential moving average, seeded with the SMA of the first `n` values.
 *
 * Seeding with the SMA is the classic definition and it makes the first value comparable with the
 * SMA series; starting from the first close instead would produce a different line for the first
 * few dozen sessions and no way to tell which convention a number came from.
 */
export function ema(values: Array<number | null>, n: number): Line {
  const out: Line = new Array(values.length).fill(null);
  const alpha = 2 / (n + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) {
      // A gap resets the average: continuing across a missing session would silently weight the
      // last valid close more heavily than the data supports.
      prev = null;
      continue;
    }
    if (prev === null) {
      const seed = windowMean(values, i, n);
      if (seed === null) continue;
      prev = seed;
      out[i] = seed;
    } else {
      prev = v * alpha + prev * (1 - alpha);
      out[i] = prev;
    }
  }
  return out;
}

/**
 * RSI from averaged gains and losses.
 *
 * A window with no losses is 100 by definition; a window with neither gains nor losses is 50 —
 * the neutral reading — rather than 100, which would call a motionless stock maximally overbought.
 */
function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Wilder's RSI.
 *
 * The first value lands at index `n` (it needs `n` changes, i.e. `n+1` closes); afterwards the
 * average gain/loss is smoothed as `(prev*(n-1) + current)/n`.
 */
export function rsi(values: Array<number | null>, n = 14): Line {
  const out: Line = new Array(values.length).fill(null);
  if (values.length <= n) return out;

  let avgGain = 0;
  let avgLoss = 0;
  let seeded = false;

  for (let i = 1; i < values.length; i++) {
    const cur = values[i];
    const prev = values[i - 1];
    if (!isNum(cur) || !isNum(prev)) {
      seeded = false;
      avgGain = 0;
      avgLoss = 0;
      continue;
    }
    const change = cur - prev;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (!seeded) {
      // Accumulate the first n changes, then average — that is the seed.
      if (i <= n) {
        avgGain += gain / n;
        avgLoss += loss / n;
        if (i === n) {
          seeded = true;
          out[i] = rsiFromAverages(avgGain, avgLoss);
        }
      }
      continue;
    }

    avgGain = (avgGain * (n - 1) + gain) / n;
    avgLoss = (avgLoss * (n - 1) + loss) / n;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Line;
  signal: Line;
  histogram: Line;
}

/** MACD(12,26,9). The signal line is an EMA of the MACD line, and the histogram is their gap. */
export function macd(values: Array<number | null>, fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const macdLine: Line = values.map((_, i) =>
    isNum(fastLine[i]) && isNum(slowLine[i]) ? (fastLine[i] as number) - (slowLine[i] as number) : null,
  );

  // `ema` seeds on the first `signalPeriod` *valid* values, which is exactly what the MACD line
  // needs: the leading nulls are warm-up, not gaps.
  const compact: Array<number | null> = macdLine.slice();
  const signalLine = ema(compact, signalPeriod);
  const histogram: Line = macdLine.map((m, i) =>
    isNum(m) && isNum(signalLine[i]) ? m - (signalLine[i] as number) : null,
  );

  return { macd: macdLine, signal: signalLine, histogram };
}

export interface BollingerResult {
  middle: Line;
  upper: Line;
  lower: Line;
}

/** Bollinger bands: SMA(n) ± k × population standard deviation of the same window. */
export function bollinger(values: Array<number | null>, n = 20, k = 2): BollingerResult {
  const middle = sma(values, n);
  const upper: Line = new Array(values.length).fill(null);
  const lower: Line = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {
    const mean = middle[i];
    if (!isNum(mean)) continue;
    let variance = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const v = values[j];
      if (!isNum(v)) {
        variance = Number.NaN;
        break;
      }
      variance += (v - mean) ** 2;
    }
    if (!Number.isFinite(variance)) continue;
    const sd = Math.sqrt(variance / n);
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { middle, upper, lower };
}

/** Wilder's ATR, seeded with the mean of the first `n` true ranges. */
export function atr(candles: CandleLike[], n = 14): Line {
  const out: Line = new Array(candles.length).fill(null);
  const trs: Array<number | null> = new Array(candles.length).fill(null);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (!c || !isNum(c.high) || !isNum(c.low)) continue;
    if (!prev || !isNum(prev.close)) {
      // The first session has no previous close; its true range is simply its own span.
      trs[i] = c.high - c.low;
      continue;
    }
    trs[i] = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }

  let prevAtr: number | null = null;
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    if (!isNum(tr)) {
      prevAtr = null;
      continue;
    }
    if (prevAtr === null) {
      const seed = windowMean(trs, i, n);
      if (seed === null) continue;
      prevAtr = seed;
      out[i] = seed;
    } else {
      prevAtr = (prevAtr * (n - 1) + tr) / n;
      out[i] = prevAtr;
    }
  }
  return out;
}

/**
 * Volume ÷ the mean volume of the previous `n` sessions.
 *
 * Null when the volume is zero or the baseline is zero: dividing by zero would report an infinite
 * "surge", and a session with no trading has no meaningful ratio.
 */
export function relativeVolume(volumes: Array<number | null>, n = 20): Line {
  return volumes.map((v, i) => {
    if (!isNum(v) || i < n) return null;
    let sum = 0;
    for (let k = i - n; k < i; k++) {
      const b = volumes[k];
      if (!isNum(b)) return null;
      sum += b;
    }
    const base = sum / n;
    return base === 0 ? null : v / base;
  });
}

export type IndicatorKey = 'sma' | 'ema' | 'rsi' | 'macd' | 'bb' | 'atr' | 'relvol';

export interface IndicatorPoint {
  date: string;
  value: number | null;
}

export interface IndicatorSeries {
  name: string;
  params: Record<string, number>;
  /** First session where the indicator has a value; null when it never warms up in this window. */
  windowStart: string | null;
  windowEnd: string | null;
  /** Prices are as stored — no split/dividend adjustment is applied anywhere in this app yet. */
  unadjusted: true;
  /** True when the window is too short to produce a single value. */
  insufficientData: boolean;
  /** How many sessions the indicator needs before its first value. */
  requiredSessions: number;
  availableSessions: number;
  points: IndicatorPoint[];
}

export interface IndicatorBundle {
  symbol: string;
  sessions: number;
  from: string | null;
  to: string | null;
  series: IndicatorSeries[];
}

const toPoints = (candles: CandleLike[], line: Line): IndicatorPoint[] =>
  candles.map((c, i) => ({ date: c.time, value: line[i] ?? null }));

function series(
  candles: CandleLike[],
  name: string,
  params: Record<string, number>,
  required: number,
  line: Line,
): IndicatorSeries {
  const points = toPoints(candles, line);
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < line.length; i++) {
    if (!isNum(line[i])) continue;
    if (firstIdx < 0) firstIdx = i;
    lastIdx = i;
  }
  return {
    name,
    params,
    windowStart: firstIdx >= 0 ? candles[firstIdx]?.time ?? null : null,
    windowEnd: lastIdx >= 0 ? candles[lastIdx]?.time ?? null : null,
    unadjusted: true,
    insufficientData: firstIdx < 0,
    requiredSessions: required,
    availableSessions: candles.length,
    points,
  };
}

/** Compute the requested indicator sets over one candle series. */
export function computeIndicators(candles: CandleLike[], sets: IndicatorKey[]): IndicatorSeries[] {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const out: IndicatorSeries[] = [];

  for (const key of sets) {
    switch (key) {
      case 'sma':
        for (const n of [20, 50, 200]) out.push(series(candles, 'SMA', { period: n }, n, sma(closes, n)));
        break;
      case 'ema':
        for (const n of [12, 26, 50, 200]) out.push(series(candles, 'EMA', { period: n }, n, ema(closes, n)));
        break;
      case 'rsi':
        out.push(series(candles, 'RSI', { period: 14, smoothing: 1 }, 15, rsi(closes, 14)));
        break;
      case 'macd': {
        const m = macd(closes);
        out.push(series(candles, 'MACD', { fast: 12, slow: 26, signal: 9 }, 26, m.macd));
        out.push(series(candles, 'MACD signal', { fast: 12, slow: 26, signal: 9 }, 34, m.signal));
        out.push(series(candles, 'MACD histogram', { fast: 12, slow: 26, signal: 9 }, 34, m.histogram));
        break;
      }
      case 'bb': {
        const bb = bollinger(closes, 20, 2);
        out.push(series(candles, 'Bollinger middle', { period: 20, sd: 2 }, 20, bb.middle));
        out.push(series(candles, 'Bollinger upper', { period: 20, sd: 2 }, 20, bb.upper));
        out.push(series(candles, 'Bollinger lower', { period: 20, sd: 2 }, 20, bb.lower));
        break;
      }
      case 'atr':
        out.push(series(candles, 'ATR', { period: 14, smoothing: 1 }, 15, atr(candles, 14)));
        break;
      case 'relvol':
        out.push(series(candles, 'Relative volume', { period: 20 }, 21, relativeVolume(volumes, 20)));
        break;
    }
  }
  return out;
}
