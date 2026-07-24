import { toNumber, toIsoDate } from '../src/scrapers/parse.utils';

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
});
