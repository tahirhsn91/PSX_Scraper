import { candleDay, toCandle, buildCandles, type Candle } from '../src/repositories/stockDetail.repository';
import { candlesQuery } from '../src/validators/schemas';
import { rangeToFrom, HISTORY_RANGES } from '../src/utils/range';

/**
 * The chart's data contract. Two things here are worth protecting: a candle is never invented
 * (a reading with no price produces a gap, not a zero), and a session day is the *exchange's*
 * calendar day, so a candle never lands on the wrong date.
 */
describe('candleDay', () => {
  it('reads the Karachi session day, not the UTC one', () => {
    // The normal case: sessionStamp writes 16:00 PKT, which is 11:00 UTC the same day.
    expect(candleDay(new Date('2026-09-16T11:00:00.000Z'))).toBe('2026-09-16');
    // A legacy row carries its own reading time: 22:12 PKT is still the same session.
    expect(candleDay(new Date('2026-09-16T17:12:00.000Z'))).toBe('2026-09-16');
    // Pakistan is UTC+5 with no DST, so past 19:00 UTC the Karachi date has already rolled.
    expect(candleDay(new Date('2026-09-16T19:00:00.000Z'))).toBe('2026-09-17');
    expect(candleDay(new Date('2026-09-16T22:00:00.000Z'))).toBe('2026-09-17');
  });
});

describe('toCandle', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    lastTradeDate: new Date('2026-09-17T11:00:00.000Z'),
    open: 100,
    high: 105,
    low: 99,
    close: 104,
    currentPrice: 104,
    volume: BigInt(1234),
    ...over,
  });

  it('maps a full price row to a candle', () => {
    expect(toCandle(row())).toEqual({
      time: '2026-09-17', open: 100, high: 105, low: 99, close: 104, volume: 1234,
    });
  });

  it('numbers a bigint volume, so it survives JSON', () => {
    const c = toCandle(row({ volume: BigInt(72901920) }))!;
    expect(typeof c.volume).toBe('number');
    expect(c.volume).toBe(72901920);
  });

  it('falls back to currentPrice for the close, since that reading is the day\'s close', () => {
    expect(toCandle(row({ close: null, currentPrice: 101.5 }))!.close).toBe(101.5);
  });

  it('never invents a candle when there is no price at all', () => {
    expect(toCandle(row({ close: null, currentPrice: null }))).toBeNull();
  });

  it('never invents a candle for a row with no session stamp', () => {
    expect(toCandle(row({ lastTradeDate: null }))).toBeNull();
  });

  it('keeps volume 0 as a reading, and missing high/low as missing', () => {
    const c = toCandle(row({ volume: BigInt(0), high: null, low: null, open: null }))!;
    expect(c.volume).toBe(0);
    expect(c.high).toBeNull();
    expect(c.low).toBeNull();
    expect(c.open).toBeNull();
  });
});

describe('buildCandles', () => {
  const p = (time: string, over: Partial<Candle> = {}): Candle => ({
    time, open: null, high: null, low: null, close: 100, volume: null, ...over,
  });

  it('merges the two sources inside one session, newest reading filling the gaps', () => {
    // The real dev shape for FFC 16 Sep: an EOD row carries open + close but no high/low, the
    // later quote row carries high/low + close but no open. Together they are one full candle.
    const out = buildCandles([
      p('2026-09-16', { open: 540, close: 531.76, volume: 834691 }),
      p('2026-09-16', { high: 538.01, low: 530.98, close: 531.76, volume: 834691 }),
    ]);
    expect(out.items).toEqual([{
      time: '2026-09-16', open: 540, high: 538.01, low: 530.98, close: 531.76, volume: 834691,
    }]);
    expect(out.skipped).toBe(0);
  });

  it('drops a reading that cannot belong to the symbol, and counts it', () => {
    // 48,131 is a KSE-100 level that the index history wrote against FFC (which trades ~530).
    const out = buildCandles([
      p('2026-09-15', { close: 530 }),
      p('2026-09-15', { close: 48131.13 }),
      p('2026-09-16', { close: 531.76 }),
    ]);
    expect(out.items.map((c) => c.close)).toEqual([530, 531.76]);
    expect(out.skipped).toBe(1);
  });

  it('still returns the real sessions of a contaminated day', () => {
    // 16 Sep holds 21 rows and 15 Sep 26 in dev; only the outsiders are discarded.
    const rows = [p('2026-09-15', { close: 530 }), p('2026-09-15', { close: 48131.13 })];
    for (let i = 0; i < 20; i += 1) rows.push(p('2026-09-16', { close: 531.76, high: 538.01 }));
    const out = buildCandles(rows);
    expect(out.items.map((c) => c.time)).toEqual(['2026-09-15', '2026-09-16']);
    expect(out.skipped).toBe(1);
  });

  it('nulls an impossible field but keeps the values that reading got right', () => {
    // Dev really has this: an FFC row with a plausible close but an index level in open/high,
    // and rows whose low is single digits. The close is kept; only the bad fields are dropped.
    const out = buildCandles([
      p('2026-09-15', { open: 48131.13, high: 48131.13, low: 7, close: 530, volume: 1000 }),
    ]);
    expect(out.items).toEqual([{
      time: '2026-09-15', open: null, high: null, low: null, close: 530, volume: 1000,
    }]);
    expect(out.sanitised).toBe(1);
    expect(out.skipped).toBe(0);
  });

  it('the newest reading wins for a field both readings carry', () => {
    const out = buildCandles([p('2026-09-17', { close: 531.01 }), p('2026-09-17', { close: 534.5, high: 535.47 })]);
    expect(out.items).toEqual([{ time: '2026-09-17', open: null, high: 535.47, low: null, close: 534.5, volume: null }]);
  });

  it('returns sessions oldest first and never invents one for an empty history', () => {
    expect(buildCandles([p('2026-09-18', { close: 1 }), p('2026-09-16', { close: 2 })]).items.map((x) => x.time))
      .toEqual(['2026-09-16', '2026-09-18']);
    expect(buildCandles([])).toEqual({ items: [], skipped: 0, sanitised: 0 });
  });
});

describe('range presets', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('turns each preset into a lower bound, and MAX into none at all', () => {
    expect(rangeToFrom('1W', now)!.toISOString().slice(0, 10)).toBe('2026-09-13');
    expect(rangeToFrom('1M', now)!.toISOString().slice(0, 10)).toBe('2026-08-20');
    expect(rangeToFrom('6M', now)!.toISOString().slice(0, 10)).toBe('2026-03-20');
    expect(rangeToFrom('1Y', now)!.toISOString().slice(0, 10)).toBe('2025-09-20');
    expect(rangeToFrom('3Y', now)!.toISOString().slice(0, 10)).toBe('2023-09-20');
    expect(rangeToFrom('5Y', now)!.toISOString().slice(0, 10)).toBe('2021-09-20');
    expect(rangeToFrom('MAX', now)).toBeUndefined();
  });

  it('gives every preset a distinct lower bound', () => {
    const bounds = HISTORY_RANGES.filter((r) => r !== 'MAX').map((r) => rangeToFrom(r, now)!.getTime());
    expect(new Set(bounds).size).toBe(bounds.length);
    // And a wider range always starts earlier than a narrower one.
    expect(rangeToFrom('1M', now)!.getTime()).toBeGreaterThan(rangeToFrom('6M', now)!.getTime());
    expect(rangeToFrom('6M', now)!.getTime()).toBeGreaterThan(rangeToFrom('1Y', now)!.getTime());
  });
});

describe('the candles query', () => {
  it('defaults to daily and accepts an explicit window', () => {
    expect(candlesQuery.parse({}).interval).toBe('1D');
    expect(candlesQuery.parse({}).from).toBeUndefined();
    const q = candlesQuery.parse({ from: '2026-01-01', to: '2026-09-17' });
    expect(q.from?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(q.to?.toISOString().slice(0, 10)).toBe('2026-09-17');
  });

  it('refuses intervals we cannot honestly serve', () => {
    for (const bad of ['5m', '1h', '1W', '1M', '', 'D']) {
      expect(candlesQuery.safeParse({ interval: bad }).success).toBe(false);
    }
  });

  it('accepts the dashboard range presets, including the new 6M', () => {
    for (const range of HISTORY_RANGES) {
      expect(candlesQuery.parse({ range }).range).toBe(range);
    }
    expect(HISTORY_RANGES).toEqual(['1W', '1M', '6M', '1Y', '2Y', '3Y', '5Y', 'MAX']);
    // 2Y stays accepted for clients that still ask for it, even though the button row dropped it.
    expect(candlesQuery.parse({ range: '2Y' }).range).toBe('2Y');
    expect(candlesQuery.safeParse({ range: '2D' }).success).toBe(false);
  });
});
