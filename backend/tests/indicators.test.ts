import {
  atr,
  bollinger,
  computeIndicators,
  ema,
  macd,
  relativeVolume,
  rsi,
  sma,
  type CandleLike,
} from '../src/services/indicators.service';

/**
 * Fixed fixture, `n` deliberately small so every expected value below was computed by hand or by
 * the independent Python reference in this PR's description. A test that re-implements the formula
 * it is testing proves nothing; these numbers were produced elsewhere and pasted in.
 */
const CLOSES = [
  44.0, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
  46.28,
];
const VOLUMES = CLOSES.map((_, i) => 1000 + i * 100);
const CANDLES: CandleLike[] = CLOSES.map((c, i) => ({
  time: `2026-09-${String(i + 1).padStart(2, '0')}`,
  open: c,
  high: c + 0.5,
  low: c - 0.5,
  close: c,
  volume: VOLUMES[i] ?? null,
}));

const round = (xs: Array<number | null>) => xs.map((v) => (v == null ? null : Number(v.toFixed(6))));

describe('SMA', () => {
  it('is null until the window is full, then the plain mean', () => {
    expect(round(sma(CLOSES, 3))).toEqual([
      null, null, 44.143333, 44.193333, 43.95, 44.03, 44.256667, 44.753333, 45.116667, 45.453333,
      45.78, 45.936667, 46.0, 45.843333, 45.973333,
    ]);
  });

  it('never averages across a missing session', () => {
    const withHole = [1, 2, null, 4, 5];
    expect(sma(withHole, 3)).toEqual([null, null, null, null, null]);
  });
});

describe('EMA', () => {
  it('seeds on the SMA and then applies 2/(n+1)', () => {
    expect(round(ema(CLOSES, 3))).toEqual([
      null, null, 44.143333, 44.146667, 43.878333, 44.104167, 44.467083, 44.783542, 45.101771,
      45.470885, 45.775443, 45.832721, 45.931361, 45.77068, 46.02534,
    ]);
  });

  it('reproduces a hand-checkable three-step calculation', () => {
    // alpha = 0.5; seed = mean(1,2,3) = 2; then 4, 5.
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe('RSI (Wilder)', () => {
  it('first value lands after 14 changes', () => {
    const line = rsi(CLOSES, 14);
    expect(line.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(round(line)[14]).toBe(72.440945);
  });

  it('a monotonic rise is 100', () => {
    const up = Array.from({ length: 20 }, (_, i) => 10 + i);
    expect(rsi(up, 14).at(-1)).toBe(100);
  });

  it('a flat series is neutral at 50, not overbought at 100', () => {
    const flat = Array.from({ length: 20 }, () => 10);
    // No losses *and* no gains: 100 would call a motionless stock maximally overbought.
    expect(rsi(flat, 14).at(-1)).toBe(50);
  });
});

describe('MACD', () => {
  it('matches the reference for fast=3, slow=5, signal=2', () => {
    const m = macd(CLOSES, 3, 5, 2);
    expect(round(m.macd)).toEqual([
      null, null, null, null, -0.159667, -0.031167, 0.100194, 0.172282, 0.220931, 0.270326, 0.281736,
      0.206917, 0.170824, 0.060323, 0.125102,
    ]);
    expect(round(m.signal)).toEqual([
      null, null, null, null, null, -0.095417, 0.034991, 0.126519, 0.18946, 0.243371, 0.268948,
      0.227594, 0.189748, 0.103464, 0.117889,
    ]);
    expect(round(m.histogram)).toEqual([
      null, null, null, null, null, 0.06425, 0.065204, 0.045764, 0.031471, 0.026955, 0.012789,
      -0.020677, -0.018923, -0.043142, 0.007212,
    ]);
  });
});

describe('Bollinger bands', () => {
  it('uses the population standard deviation over the window', () => {
    const bb = bollinger(CLOSES, 5, 2);
    expect(round(bb.middle)).toEqual([
      null, null, null, null, 44.038, 44.104, 44.202, 44.404, 44.658, 45.104, 45.454, 45.666,
      45.852, 45.89, 45.978,
    ]);
    expect(round(bb.upper)[4]).toBe(44.52056);
    expect(round(bb.lower)[4]).toBe(43.55544);
  });

  it('collapses to the mean on a flat series', () => {
    const flat = Array.from({ length: 25 }, () => 100);
    const bb = bollinger(flat, 20, 2);
    expect(bb.upper.at(-1)).toBe(100);
    expect(bb.lower.at(-1)).toBe(100);
  });
});

describe('ATR', () => {
  it('starts at the mean of the first n true ranges', () => {
    expect(round(atr(CANDLES, 3))).toEqual([
      null, null, 1.0, 1.0, 1.013333, 1.082222, 1.054815, 1.036543, 1.024362, 1.016241, 1.010828,
      1.007218, 1.004812, 1.003208, 1.058805,
    ]);
  });
});

describe('relative volume', () => {
  it('compares with the previous n sessions, excluding today', () => {
    // 1300 / mean(1000, 1100, 1200) = 1.1818…
    expect(round(relativeVolume(VOLUMES, 3))[3]).toBe(1.181818);
  });

  it('returns null rather than Infinity when the baseline is zero', () => {
    expect(relativeVolume([0, 0, 0, 500], 3)[3]).toBeNull();
  });
});

describe('computeIndicators', () => {
  it('carries the parameters, the window and the unadjusted flag', () => {
    const out = computeIndicators(CANDLES, ['sma']);
    expect(out).toHaveLength(3); // 20 / 50 / 200
    const s20 = out[0]!;
    expect(s20.name).toBe('SMA');
    expect(s20.params).toEqual({ period: 20 });
    expect(s20.unadjusted).toBe(true);
    expect(s20.requiredSessions).toBe(20);
    expect(s20.availableSessions).toBe(15);
    expect(s20.insufficientData).toBe(true);
    expect(s20.windowStart).toBeNull();
    expect(s20.points).toHaveLength(15);
  });

  it('marks insufficient history instead of guessing a value', () => {
    // 15 closes is exactly enough for RSI(14) and not enough for Bollinger(20).
    const [rsiSeries, ...bbSeries] = computeIndicators(CANDLES, ['rsi', 'bb']);
    expect(rsiSeries!.insufficientData).toBe(false);
    expect(rsiSeries!.points.filter((p) => p.value !== null)).toHaveLength(1);
    for (const s of bbSeries) {
      expect(s.insufficientData).toBe(true);
      expect(s.points.every((p) => p.value === null)).toBe(true);
    }
  });

  it('reports the first and last session that actually have a value', () => {
    const out = computeIndicators(CANDLES, ['ema']);
    const e12 = out[0]!;
    expect(e12.insufficientData).toBe(false);
    expect(e12.windowStart).toBe(CANDLES[11]!.time); // EMA(12) warms up at index 11
    expect(e12.windowEnd).toBe(CANDLES[14]!.time);
  });
});
