import { toNumber, toIsoDate, parseWeek52Range } from '../src/scrapers/parse.utils';

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
  });
});
