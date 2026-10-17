import { walkBackToTradingDay } from '../src/services/marketCalendar.service';
import type { TradingDayState } from '../src/services/marketCalendar.service';

/**
 * The clamp that keeps a quote out of a session that never happened.
 *
 * The state source is injected so the walk can be tested without the holiday table — the point of
 * the test is the boundary behaviour (weekend, holiday chains, an unreadable calendar), not the
 * database read.
 */

/** 16:00 PKT — the stamp every writer converges on. */
const stamp = (iso: string): Date => new Date(iso);

const fakeCalendar = (holidays: string[]): ((d: Date) => Promise<TradingDayState>) => {
  const holidaySet = new Set(holidays);
  return async (d: Date) => {
    const day = d.getUTCDay();
    if (day === 0 || day === 6) return 'weekend';
    return holidaySet.has(d.toISOString().slice(0, 10)) ? 'holiday' : 'trading';
  };
};

describe('walkBackToTradingDay', () => {
  it('leaves a trading day untouched, time of day included', async () => {
    const friday = stamp('2026-10-16T11:00:00Z'); // Fri 16:00 PKT
    const out = await walkBackToTradingDay(friday, fakeCalendar([]));
    expect(out?.toISOString()).toBe('2026-10-16T11:00:00.000Z');
  });

  it('moves a Saturday reading back to Friday', async () => {
    const saturday = stamp('2026-10-17T11:00:00Z');
    const out = await walkBackToTradingDay(saturday, fakeCalendar([]));
    expect(out?.toISOString()).toBe('2026-10-16T11:00:00.000Z');
  });

  it('moves a Sunday reading back to Friday', async () => {
    const sunday = stamp('2026-10-18T11:00:00Z');
    const out = await walkBackToTradingDay(sunday, fakeCalendar([]));
    expect(out?.toISOString()).toBe('2026-10-16T11:00:00.000Z');
  });

  it('skips a holiday chain', async () => {
    // Tue 29 Sep and Wed 30 Sep 2026 are listed holidays; Thursday trades.
    const wednesday = stamp('2026-09-30T11:00:00Z');
    const out = await walkBackToTradingDay(
      wednesday,
      fakeCalendar(['2026-09-29', '2026-09-30']),
    );
    expect(out?.toISOString()).toBe('2026-09-28T11:00:00.000Z'); // Monday
  });

  it('keeps the reading when the calendar cannot be read', async () => {
    const saturday = stamp('2026-10-17T11:00:00Z');
    const out = await walkBackToTradingDay(saturday, async () => 'unknown');
    expect(out?.toISOString()).toBe('2026-10-17T11:00:00.000Z');
  });

  it('gives up rather than walking forever', async () => {
    const out = await walkBackToTradingDay(stamp('2026-10-17T11:00:00Z'), async () => 'holiday', 5);
    expect(out).toBeNull();
  });
});
