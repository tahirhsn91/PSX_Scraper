import { yahooTicker, parseDailyBars } from '../src/scrapers/yahoo.scraper';
import { planUpdate, sessionStampFor, assertStampMatchesSessionRule, type ExistingCandle } from '../src/services/candleBackfill.service';
import { sessionStamp } from '../src/scrapers/parse.utils';

describe('yahooTicker', () => {
  it('maps a PSX symbol to its Yahoo ticker by rule, not by list', () => {
    expect(yahooTicker('FFC')).toBe('FFC.KA');
    expect(yahooTicker(' huBC ')).toBe('HUBC.KA'); // trimmed, upper-cased
    expect(yahooTicker('AGLNCPS')).toBe('AGLNCPS.KA'); // preference shares are covered
    expect(yahooTicker('786')).toBe('786.KA'); // numeric tickers too — the rule has no exceptions
  });
});

describe('parseDailyBars', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    chart: {
      result: [{
        timestamp: [1758000000, 1758086400, 1758172800],
        indicators: {
          quote: [{
            open: [457.15, null, 529.99],
            high: [460.0, null, 544.0],
            low: [451.95, null, 525.0],
            close: [452.59, null, 541.37],
            volume: [1595164, null, 1056605],
          }],
        },
      }],
      ...over,
    },
  });

  it('maps Yahoo bars to dated candles, oldest first', () => {
    const bars = parseDailyBars(payload() as never);
    expect(bars).toHaveLength(2); // the middle bar has no close and is dropped
    expect(bars[0]).toEqual({
      date: '2025-09-16', open: 457.15, high: 460, low: 451.95, close: 452.59, volume: 1595164,
    });
    expect(bars[1]!.close).toBe(541.37);
  });

  it('drops a bar with no close rather than inventing a price', () => {
    const bars = parseDailyBars(payload() as never);
    expect(bars.every((b) => typeof b.close === 'number')).toBe(true);
  });

  it('keeps a missing high/low as null instead of filling it', () => {
    const p = payload();
    (p.chart.result[0]!.indicators.quote[0] as Record<string, unknown>).high = [null, null, 544.0];
    expect(parseDailyBars(p as never)[0]!.high).toBeNull();
  });

  it('returns nothing for an empty or errored payload', () => {
    expect(parseDailyBars({} as never)).toEqual([]);
    expect(parseDailyBars({ chart: { result: [] } } as never)).toEqual([]);
  });
});

describe('planUpdate — the "never duplicate, never overwrite" rules', () => {
  const bar = { date: '2025-09-16', open: 457.15, high: 460, low: 451.95, close: 452.59, volume: 1595164 };
  const have = (over: Partial<ExistingCandle> = {}): ExistingCandle => ({
    open: null, high: null, low: null, close: null, volume: null, ...over,
  });

  it('inserts a session we do not have at all', () => {
    expect(planUpdate(null, bar)).toEqual({ action: 'insert', fields: {} });
  });

  it('fills only the gaps of a session we partly have', () => {
    // Our DPS-era row: open + close + volume, no high/low — the exact FFC case.
    const plan = planUpdate(have({ open: 457.15, close: 452.59, volume: 1595164 }), bar);
    expect(plan.action).toBe('fill');
    expect(plan.fields).toEqual({ high: 460, low: 451.95 });
  });

  it('never overwrites a value we already hold', () => {
    const plan = planUpdate(have({ open: 457.15, high: 460, low: 451.95, close: 452.59, volume: 1595164 }), bar);
    expect(plan.action).toBe('skip');
    expect(plan.fields).toEqual({});
    // Even a conflicting official close stays: adjustments must not rewrite history silently.
    const conflicting = planUpdate(have({ close: 400 }), { ...bar, open: null, high: null, low: null, volume: null });
    expect(conflicting.action).toBe('skip');
  });

  it('skips a complete session outright, so re-running does no writes', () => {
    expect(planUpdate(have({ open: 1, high: 2, low: 3, close: 4, volume: 5 }), bar).action).toBe('skip');
  });

  it('does not fill a field the remote bar itself lacks', () => {
    const plan = planUpdate(have({ close: 452.59 }), { ...bar, open: null, high: null, low: null, volume: null });
    expect(plan.action).toBe('skip');
  });
});

describe('session keying', () => {
  it('stamps a backfilled day the same way the live pipeline does', () => {
    for (const d of ['2026-09-16', '2026-01-02', '2025-12-31']) {
      expect(sessionStampFor(d).toISOString()).toBe(sessionStamp(d));
      expect(() => assertStampMatchesSessionRule(d)).not.toThrow();
    }
  });

  it('is 16:00 PKT — 11:00 UTC', () => {
    expect(sessionStampFor('2026-09-16').toISOString()).toBe('2026-09-16T11:00:00.000Z');
  });
});
