import { describe, expect, it } from 'vitest';
import { DASH, formatCount, formatDate, formatNumber, formatPercent, formatSigned, trendOf } from './format';

describe('formatNumber', () => {
  it('groups thousands, two decimals by default', () => {
    // Money on this site is PKR with two decimals; the default is the common case, not a surprise.
    expect(formatNumber(1234567)).toBe('1,234,567.00');
    expect(formatNumber(1234.5678)).toBe('1,234.57');
    expect(formatNumber(1234.5678, { maximumFractionDigits: 0 })).toBe('1,235');
  });

  it('renders a dash for a missing value rather than a zero', () => {
    // Zero is a reading; null is the absence of one. They must not look the same.
    expect(formatNumber(null)).toBe(DASH);
    expect(formatNumber(0)).not.toBe(DASH);
  });
});

describe('formatPercent / formatSigned', () => {
  it('keeps the sign on both sides of zero', () => {
    expect(formatSigned(1.234)).toBe('+1.23');
    expect(formatSigned(-1.234)).toBe('-1.23');
    expect(formatPercent(5)).toBe('+5.00%');
    expect(formatPercent(-5)).toBe('-5.00%');
    // Zero is neither up nor down, so it carries no sign.
    expect(formatPercent(0)).toBe('0.00%');
  });
});

describe('formatDate', () => {
  it('renders a dash when the source published no date', () => {
    expect(formatDate(null)).toBe(DASH);
    expect(formatDate(undefined)).toBe(DASH);
  });
});

describe('trendOf', () => {
  it('treats a move inside the band as flat', () => {
    expect(trendOf(0.0001)).toBe('flat');
    expect(trendOf(1)).toBe('up');
    expect(trendOf(-1)).toBe('down');
    expect(trendOf(null)).toBeNull();
  });
});

describe('formatCount', () => {
  it('has no decimals', () => {
    expect(formatCount(1234.9)).toBe('1,235');
  });
});
