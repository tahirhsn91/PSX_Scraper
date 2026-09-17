import { toNumber, toIsoDate, parseWeek52Range, sessionStamp } from '../src/scrapers/parse.utils';

describe('parse.utils', () => {
  describe('toNumber', () => {
    it('parses formatted currency', () => {
      expect(toNumber('Rs. 1,234.50')).toBe(1234.5);
      expect(toNumber('-3.1%')).toBe(-3.1);
      expect(toNumber('45')).toBe(45);
    });
    it('returns null for junk/empty', () => {
      expect(toNumber('')).toBeNull();
      expect(toNumber('N/A')).toBeNull();
      expect(toNumber(null)).toBeNull();
      expect(toNumber(undefined)).toBeNull();
    });
  });

  describe('toIsoDate', () => {
    it('parses ISO strings', () => {
      expect(toIsoDate('2024-01-15')).toBe(new Date('2024-01-15').toISOString());
    });
    it('returns null for invalid dates', () => {
      expect(toIsoDate('not-a-date')).toBeNull();
      expect(toIsoDate(null)).toBeNull();
    });
  });

  describe('sessionStamp', () => {
    it('stamps the reading to its own session day at 16:00 PKT', () => {
      // 19:32 PKT on the 17th -> that day's session marker.
      expect(sessionStamp('2026-09-17T14:32:46.369Z')).toBe('2026-09-17T11:00:00.000Z');
    });

    it('keeps a just-after-midnight PKT reading on the same session day', () => {
      // 00:30 PKT on the 18th is still the 18th in Karachi, though it is the 17th in UTC.
      expect(sessionStamp('2026-09-17T19:30:00.000Z')).toBe('2026-09-18T11:00:00.000Z');
    });

    it('maps a stale reading to ITS session, never to today', () => {
      // What a pre-open or weekend fetch sees: the exchange's last update, Friday's close.
      expect(sessionStamp('2026-09-18T10:30:00.000Z')).toBe('2026-09-18T11:00:00.000Z');
    });

    it('returns null for junk so callers can fall back instead of inventing a date', () => {
      expect(sessionStamp(null)).toBeNull();
      expect(sessionStamp('')).toBeNull();
      expect(sessionStamp('not-a-date')).toBeNull();
    });
  });

  describe('parseWeek52Range', () => {
    it('reads the pair PSX publishes for FFC', () => {
      expect(parseWeek52Range('441.7', '685')).toEqual({ low: 441.7, high: 685 });
    });

    it('handles the thousands separator the displayed text uses', () => {
      expect(parseWeek52Range('1,234.50', '2,100')).toEqual({ low: 1234.5, high: 2100 });
    });

    it('sorts the endpoints, so a reversed pair is still a range', () => {
      expect(parseWeek52Range('685', '441.7')).toEqual({ low: 441.7, high: 685 });
    });

    it('keeps the side that was read and nulls the other', () => {
      expect(parseWeek52Range('441.7', null)).toEqual({ low: 441.7, high: null });
      expect(parseWeek52Range(null, '685')).toEqual({ low: null, high: 685 });
    });

    it('returns nulls when the page had no 52-week block', () => {
      expect(parseWeek52Range(null, null)).toEqual({ low: null, high: null });
      expect(parseWeek52Range(undefined, undefined)).toEqual({ low: null, high: null });
      expect(parseWeek52Range('', '')).toEqual({ low: null, high: null });
    });

    it('never invents a number from junk', () => {
      expect(parseWeek52Range('N/A', '—')).toEqual({ low: null, high: null });
    });

    it("treats Sarmaaya's 0.0/0.0 placeholder as no reading, not as a range of zero", () => {
      // ENGRO on sarmaaya.pk/stocks/ENGRO really does print "0.0" for both endpoints.
      expect(parseWeek52Range('0.0', '0.0')).toEqual({ low: null, high: null });
    });

    it('drops a single non-positive endpoint and keeps the other', () => {
      expect(parseWeek52Range('0', '685')).toEqual({ low: null, high: 685 });
      expect(parseWeek52Range('441.7', '0')).toEqual({ low: 441.7, high: null });
    });

    it('rejects negatives the same way', () => {
      expect(parseWeek52Range('-5', '-1')).toEqual({ low: null, high: null });
    });
  });
});
