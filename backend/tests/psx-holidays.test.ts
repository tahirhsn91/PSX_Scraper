import { readFileSync } from 'fs';
import { join } from 'path';
import { datesInCell, parseHolidayTable } from '../src/scrapers/psxHolidays.scraper';
import { classifyTradingDay, isWeekend, pktDay } from '../src/services/marketCalendar.service';

/**
 * PSX's own Calendar Holidays page, captured 2026-09-28.
 *
 * Tested against the page rather than a mock, because the whole difficulty is in the markup: the
 * ordinals arrive as `5<sup>th</sup>` (so the day number and its suffix are only joined after the
 * tags come off), and a multi-day holiday is a single cell mixing a Hijri range in parentheses with
 * a list of Gregorian days in front of the month.
 */
const fixture = readFileSync(join(__dirname, 'fixtures', 'psx-calendar-holidays.html'), 'utf8');
const holidays = parseHolidayTable(fixture);
const dates = holidays.map((h) => h.date);

describe('the published holiday table', () => {
  it('expands the twelve 2026 entries to the 17 days PSX declares', () => {
    // PSX's own "Total" row says 17 days. Two of them are declared twice - 23 March (Pakistan Day
    // and the third day of Eid-ul-Fitr) and 28 May (Youm-e-Takbeer and the third day of Eid-ul-Azha)
    // - so 17 declared days are 15 distinct dates, plus the one stray 2024 row the page still carries.
    const declared = new Map<string, number>();
    for (const h of holidays) declared.set(h.name, Math.max(declared.get(h.name) ?? 0, h.days ?? 1));
    expect([...declared.values()].reduce((sum, n) => sum + n, 0)).toBe(18);
    expect(new Set(dates).size).toBe(16);
    expect(dates.filter((d) => d.startsWith('2026-'))).toHaveLength(15);
  });

  it('reads a single-day entry', () => {
    expect(dates).toContain('2026-02-05');
    expect(holidays.find((h) => h.date === '2026-02-05')?.name).toBe('Kashmir Day');
    expect(holidays.find((h) => h.date === '2026-12-25')?.name).toBe('Quaid-e-Azam Day/Christmas');
  });

  it('reads every day of a multi-day entry, from one cell', () => {
    expect(dates.filter((d) => d.startsWith('2026-03-2'))).toEqual([
      '2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23',
    ]);
    expect(dates.filter((d) => d.startsWith('2026-05-2'))).toEqual([
      '2026-05-26', '2026-05-27', '2026-05-28',
    ]);
    expect(dates.filter((d) => d.startsWith('2026-06-2'))).toEqual(['2026-06-25', '2026-06-26']);
  });

  it('never reads the Hijri range in the same cell as Gregorian days', () => {
    // "(1st, 2nd and 3rd Shawal 1447 AH)" must contribute nothing: no year 1447, no day-of-month
    // from that parenthetical. The 2024 row is the only date outside the year PSX publishes for.
    expect(dates.filter((d) => !d.startsWith('2026-'))).toEqual(['2024-12-26']);
    expect(dates).not.toContain('2026-07-08');
  });

  it('skips the header row and the Total footer', () => {
    expect(holidays.some((h) => /total/i.test(h.name))).toBe(false);
    expect(holidays.some((h) => h.name === 'S. No')).toBe(false);
  });

  it('skips a cell it cannot read instead of inventing a day', () => {
    const row = '<tr><td>1</td><td>Mystery Holiday</td><td>sometime next spring</td><td>1</td></tr>';
    expect(parseHolidayTable(row)).toEqual([]);
    // A day that cannot exist in that month is dropped, not clamped to the month's last day.
    expect(datesInCell('Monday, 31st February, 2026')).toEqual([]);
    expect(datesInCell('Monday, 29th February, 2026')).toEqual([]);
  });

  it('carries the one-community annotation, which is not a market-wide closure', () => {
    const entry = holidays.find((h) => h.date === '2024-12-26');
    expect(entry?.name).toBe('Day after Christmas');
    expect(entry?.partial).toBe(true);
    expect(classifyTradingDay(new Date('2024-12-26T06:00:00Z'), entry)).toBe('trading');
    // Every 2026 entry is a market-wide closure.
    expect(holidays.filter((h) => h.date.startsWith('2026-')).every((h) => !h.partial)).toBe(true);
  });
});

describe('the holiday hole this calendar exists for', () => {
  it('is not on the published list - which is why the list cannot be the only signal', () => {
    // 2026-08-26 sits in stock_prices as 441 rows with volume 0. PSX's list does not carry it; it
    // carries 2026-08-25 instead - a Tuesday both independent session calendars (Sarmaaya's
    // volume-history and stockanalysis.com) publish as a trading day, and which our own rows show
    // traded. An Eid observance can land a day either side of the published date, so the list
    // corroborates the gate and never decides it.
    expect(dates).not.toContain('2026-08-26');
    expect(dates).toContain('2026-08-25');
  });
});

describe('classifyTradingDay', () => {
  const wednesday = new Date('2026-08-26T06:00:00Z');
  const saturday = new Date('2026-09-19T06:00:00Z');

  it('reports a weekend on the Karachi clock', () => {
    expect(isWeekend(saturday)).toBe(true);
    // 2026-09-18 22:00 UTC is 03:00 Saturday in Karachi - a weekend, despite the UTC date.
    expect(isWeekend(new Date('2026-09-18T22:00:00Z'))).toBe(true);
    expect(isWeekend(new Date('2026-09-18T06:00:00Z'))).toBe(false);
  });

  it('separates a listed holiday from an ordinary weekday', () => {
    expect(classifyTradingDay(wednesday, { partial: false })).toBe('holiday');
    expect(classifyTradingDay(wednesday, null)).toBe('trading');
  });

  it('reports what it cannot know as unknown, not as closed', () => {
    // The calendar being unreadable must not read as "the market was shut": a caller that cannot
    // tell the two apart would silently drop a real session.
    expect(classifyTradingDay(wednesday, undefined)).toBe('unknown');
    expect(classifyTradingDay(saturday, undefined)).toBe('weekend');
  });

  it('stamps the Karachi day, not the UTC one', () => {
    expect(pktDay(new Date('2026-09-18T22:00:00Z'))).toBe('2026-09-19');
    expect(pktDay(new Date('2026-09-18T06:00:00Z'))).toBe('2026-09-18');
  });
});
