import { isMarketOpen } from '../src/utils/marketHours';

/** PKT is a fixed UTC+5, so an instant can be written as a UTC string and read as PKT. */
const at = (iso: string): Date => new Date(iso);

describe('isMarketOpen', () => {
  it('is open during the session (Wed 10:00 PKT)', () => {
    expect(isMarketOpen(at('2026-09-16T05:00:00Z'))).toBe(true);
  });

  it('is closed before the opening bell (Wed 09:20 PKT)', () => {
    expect(isMarketOpen(at('2026-09-16T04:20:00Z'))).toBe(false);
  });

  it('is open from the 09:25 pre-open window', () => {
    expect(isMarketOpen(at('2026-09-16T04:25:00Z'))).toBe(true);
    expect(isMarketOpen(at('2026-09-16T04:24:00Z'))).toBe(false);
  });

  it('keeps polling until the close has settled (15:35 PKT inclusive)', () => {
    expect(isMarketOpen(at('2026-09-16T10:35:00Z'))).toBe(true);
    expect(isMarketOpen(at('2026-09-16T10:36:00Z'))).toBe(false);
  });

  it('is closed on the weekend (Sat 12:00 PKT)', () => {
    expect(isMarketOpen(at('2026-09-19T07:00:00Z'))).toBe(false);
  });

  it('is closed on a Friday evening in PKT even though it is still Friday in UTC', () => {
    // Fri 20:00 PKT = Fri 15:00 UTC — after the bell, still a weekday.
    expect(isMarketOpen(at('2026-09-18T15:00:00Z'))).toBe(false);
  });

  it('evaluates the weekday on the PKT wall clock, not UTC', () => {
    // Sat 00:30 PKT is Fri 19:30 UTC — a trading day that has already closed, not Saturday.
    expect(isMarketOpen(at('2026-09-18T19:30:00Z'))).toBe(false);
  });

  it('honours a custom window', () => {
    const window = { openMinutes: 0, closeMinutes: 24 * 60 - 1 };
    expect(isMarketOpen(at('2026-09-16T19:00:00Z'), window)).toBe(true);
  });
});
