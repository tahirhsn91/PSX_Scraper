import { matchesTechnical, type TechnicalRow } from '../src/services/technicalUniverse.service';

/** A row is only as good as its nulls: a missing indicator must never satisfy a bound. */
const row = (over: Partial<TechnicalRow> = {}): TechnicalRow => ({
  rsi: 55,
  sma50: 100,
  sma200: 90,
  sessions: 300,
  close: 110,
  ...over,
});

describe('technical screener criteria', () => {
  it('passes a row that satisfies every bound', () => {
    expect(matchesTechnical(row(), 110, { minRsi: 50, maxRsi: 60, maRelation: 'above_sma50' })).toBe(true);
  });

  it('treats an unknown RSI as a miss, not as zero', () => {
    expect(matchesTechnical(row({ rsi: null }), 110, { minRsi: 0 })).toBe(false);
    expect(matchesTechnical(row({ rsi: null }), 110, { maxRsi: 100 })).toBe(false);
  });

  it('compares the close against each average separately', () => {
    expect(matchesTechnical(row(), 110, { maRelation: 'above_sma50' })).toBe(true);
    expect(matchesTechnical(row(), 110, { maRelation: 'above_sma200' })).toBe(true);
    expect(matchesTechnical(row(), 110, { maRelation: 'below_sma200' })).toBe(false);
    // 95 is below the 50-session average but above the 200-session one.
    expect(matchesTechnical(row(), 95, { maRelation: 'below_sma50' })).toBe(true);
    expect(matchesTechnical(row(), 95, { maRelation: 'below_sma200' })).toBe(false);
  });

  it('requires an average to exist before claiming a relation', () => {
    expect(matchesTechnical(row({ sma200: null }), 110, { maRelation: 'above_sma200' })).toBe(false);
  });

  it('excludes a stock sitting exactly on the average from both sides', () => {
    expect(matchesTechnical(row(), 100, { maRelation: 'above_sma50' })).toBe(false);
    expect(matchesTechnical(row(), 100, { maRelation: 'below_sma50' })).toBe(false);
  });
});
