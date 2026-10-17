import {
  LIQUIDITY_FLOOR_SHARES,
  MIN_SESSIONS_FOR_RELATIVE_VOLUME,
  periodReturn,
  rankMovers,
} from '../src/services/movers.service';
import type { MoverStatRow } from '../src/repositories/movers.repository';

/**
 * The ranking rules: which rows are eligible, what each one is ranked on, and what the row says
 * about itself. These are the parts a reader can be misled by, so they are tested without a
 * database — the query is a separate concern.
 */

const row = (over: Partial<MoverStatRow> & { symbol: string }): MoverStatRow => ({
  companyName: `${over.symbol} Ltd`,
  sector: 'TEST',
  price: 100,
  change: 1,
  changePercent: 1,
  volume: LIQUIDITY_FLOOR_SHARES * 5,
  sessionDate: '2026-10-16T11:00:00.000Z',
  avgVolume20: LIQUIDITY_FLOOR_SHARES * 5,
  close1w: 95,
  close1m: 80,
  prevClose: 99,
  sessions: 22,
  ...over,
});

describe('periodReturn', () => {
  it('uses the exchange change% for one day', () => {
    expect(periodReturn(row({ symbol: 'A', changePercent: 2.5 }), '1d')).toBe(2.5);
  });

  it('falls back to the stored previous close when the source published no change%', () => {
    // 110 against a 100 close is +10%, whichever way it is derived.
    const r = row({ symbol: 'A', price: 110, changePercent: null, prevClose: 100 });
    expect(periodReturn(r, '1d')).toBe(10);
  });

  it('measures a week and a month from stored closes', () => {
    expect(periodReturn(row({ symbol: 'A', price: 110, close1w: 100 }), '1w')).toBe(10);
    expect(periodReturn(row({ symbol: 'A', price: 110, close1m: 88 }), '1m')).toBe(25);
  });

  it('returns null rather than dividing by a missing or zero close', () => {
    expect(periodReturn(row({ symbol: 'A', price: 110, close1w: null }), '1w')).toBeNull();
    expect(periodReturn(row({ symbol: 'A', price: 110, close1m: 0 }), '1m')).toBeNull();
  });
});

describe('rankMovers', () => {
  const stats = [
    row({ symbol: 'BIG', changePercent: 3, volume: 5_000_000 }),
    row({ symbol: 'SMALL', changePercent: 8, volume: 2_000 }),
    row({ symbol: 'FALL', changePercent: -4, volume: 900_000 }),
    row({ symbol: 'BIGVOL', changePercent: 0.5, volume: 20_000_000 }),
  ];

  it('excludes symbols under the liquidity floor and counts them', () => {
    const { rows, excludedIlliquid } = rankMovers(stats, 'gainers', '1d', 10);
    expect(excludedIlliquid).toBe(1);
    expect(rows.map((r) => r.symbol)).not.toContain('SMALL');
  });

  it('ranks gainers by the period return, descending', () => {
    const { rows } = rankMovers(stats, 'gainers', '1d', 10);
    expect(rows.map((r) => r.symbol)).toEqual(['BIG', 'BIGVOL', 'FALL']);
  });

  it('ranks losers with the biggest fall first', () => {
    const { rows } = rankMovers(stats, 'losers', '1d', 10);
    expect(rows[0]?.symbol).toBe('FALL');
  });

  it('ranks activity on volume, not on return', () => {
    const { rows } = rankMovers(stats, 'active', '1d', 10);
    expect(rows.map((r) => r.symbol)).toEqual(['BIGVOL', 'BIG', 'FALL']);
  });

  it('ranks unusual volume on the relative multiple', () => {
    const unusual = [
      row({ symbol: 'QUIET', volume: 100_000, avgVolume20: 1_000_000 }),
      row({ symbol: 'LOUD', volume: 300_000, avgVolume20: 50_000 }),
    ];
    const { rows } = rankMovers(unusual, 'unusual', '1d', 10);
    expect(rows.map((r) => r.symbol)).toEqual(['LOUD', 'QUIET']);
    expect(rows[0]?.relativeVolume).toBe(6);
  });

  it('does not invent a relative volume without enough sessions', () => {
    const young = [row({ symbol: 'NEW', sessions: MIN_SESSIONS_FOR_RELATIVE_VOLUME - 1 })];
    const { rows } = rankMovers(young, 'unusual', '1d', 10);
    expect(rows[0]?.relativeVolume).toBeNull();
    expect(rows[0]?.reason).toMatch(/shares traded/i);
  });

  it('states the window in every row reason', () => {
    const { rows } = rankMovers(stats, 'gainers', '1w', 10);
    expect(rows[0]?.reason).toBe('+5.26% over 5 sessions');
  });

  it('honours the limit', () => {
    const { rows } = rankMovers(stats, 'gainers', '1d', 2);
    expect(rows).toHaveLength(2);
  });
});
