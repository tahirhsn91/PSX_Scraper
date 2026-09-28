import { CANDLE_MAX_DEVIATION, candleIsPlausible } from '../src/services/sessionCandle.service';

/**
 * The rule that makes this source safe to write from.
 *
 * TradingView's `PSX:OGTI` is not the exchange's OGTI — on 2026-09-28 its candle closed at 30,171.79
 * while ours (and Sarmaaya's) is 35,012.45, a different instrument under the same ticker — and the
 * scanner answers with no per-symbol timestamp, so the candle cannot prove its own freshness either.
 * The close agreeing with the value we already hold is the only evidence available, so it is what
 * gates every write. These pins exist so a future change cannot quietly widen or drop it.
 */
describe('a candle is written only when its close reconciles with the value we hold', () => {
  it('accepts the live KSE-100 candle, which agrees with the level we stored to four decimals', () => {
    expect(candleIsPlausible(170425.6242, 170425.62)).toBe(true);
  });

  it("refuses TradingView's OGTI — a different instrument wearing our ticker", () => {
    expect(candleIsPlausible(30171.7853, 35012.45)).toBe(false);
  });

  it('accepts and refuses stock candles by the same rule', () => {
    expect(candleIsPlausible(318.69, 318.69)).toBe(true); // OGDC, TV and ours identical
    expect(candleIsPlausible(542.51, 542.51)).toBe(true); // FFC, identical
    expect(candleIsPlausible(318.69, 300)).toBe(false); // 6% out: not the same session
  });

  it('holds the line at the documented tolerance', () => {
    const reference = 100;
    expect(candleIsPlausible(reference * (1 + CANDLE_MAX_DEVIATION), reference)).toBe(true);
    expect(candleIsPlausible(reference * (1 + CANDLE_MAX_DEVIATION * 1.01), reference)).toBe(false);
    expect(candleIsPlausible(reference * (1 - CANDLE_MAX_DEVIATION), reference)).toBe(true);
  });

  it('refuses when there is nothing to check against — no proof is not a pass', () => {
    expect(candleIsPlausible(170425.6242, null)).toBe(false);
    expect(candleIsPlausible(null, 170425.62)).toBe(false);
    expect(candleIsPlausible(10, 0)).toBe(false);
    expect(candleIsPlausible(10, -1)).toBe(false);
    expect(candleIsPlausible(Number.NaN, 100)).toBe(false);
    expect(candleIsPlausible(100, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
