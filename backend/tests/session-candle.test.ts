import { CANDLE_MAX_DEVIATION, candleIsPlausible, candleSessionStamp } from '../src/services/sessionCandle.service';

/**
 * Which session a candle read *now* belongs to.
 *
 * The bug this pins: the service originally stamped the candle with `sessionStamp(now)`, i.e. the PKT
 * calendar date of the instant, so a run at 00:38 PKT on 29 Sep stamped the 29th's session while the
 * scanner was still answering with the candle that closed at 15:35 on the 28th. The sync then found no
 * row for that session and wrote nothing — 11 indices and 508 stocks reported `noRow`.
 */
describe('the session a candle belongs to', () => {
  const at = (iso: string) => candleSessionStamp(new Date(iso)).toISOString();
  const SESSION_28 = '2026-09-28T11:00:00.000Z'; // 16:00 PKT, Mon 28 Sep
  const SESSION_29 = '2026-09-29T11:00:00.000Z'; // 16:00 PKT, Tue 29 Sep

  it('is today during the session', () => {
    expect(at('2026-09-28T05:00:00Z')).toBe(SESSION_28); // 10:00 PKT Mon
    expect(at('2026-09-28T08:30:00Z')).toBe(SESSION_28); // 13:30 PKT Mon
    expect(at('2026-09-28T10:30:00Z')).toBe(SESSION_28); // 15:30 PKT, past the settle
  });

  it('is the previous trading day before the open — the case that shipped broken', () => {
    expect(at('2026-09-28T19:37:59Z')).toBe(SESSION_28); // 00:38 PKT Tue 29 Sep
    expect(at('2026-09-29T02:00:00Z')).toBe(SESSION_28); // 07:00 PKT Tue, pre-open
    expect(at('2026-09-29T04:25:00Z')).toBe(SESSION_28); // 09:25 PKT Tue, five minutes before the open
  });

  it('switches to today exactly at the open', () => {
    expect(at('2026-09-29T04:29:59Z')).toBe(SESSION_28); // 09:29:59 PKT
    expect(at('2026-09-29T04:30:00Z')).toBe(SESSION_29); // 09:30:00 PKT
  });

  it('steps back over the weekend to Friday', () => {
    expect(at('2026-10-03T07:00:00Z')).toBe('2026-10-02T11:00:00.000Z'); // 12:00 PKT Sat → Fri 2 Oct
    expect(at('2026-10-04T07:00:00Z')).toBe('2026-10-02T11:00:00.000Z'); // 12:00 PKT Sun → Fri 2 Oct
    expect(at('2026-10-02T19:30:00Z')).toBe('2026-10-02T11:00:00.000Z'); // 00:30 PKT Sat → Fri 2 Oct
  });
});

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
