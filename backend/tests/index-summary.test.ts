import { buildIndexSummary, toHistoryItem, liveReading, IndexValueRow } from '../src/services/indexSummary';

const row = (date: string, value: number, open: number | null = null, volume: number | null = null): IndexValueRow => ({
  tradeDate: new Date(date),
  value,
  open,
  volume: volume === null ? null : BigInt(volume),
});

describe('buildIndexSummary', () => {
  const TODAY = '2026-09-14T11:00:00.000Z';
  const PREV = '2026-09-11T11:00:00.000Z';

  it('derives value, change and previousClose from the two newest daily closes', () => {
    const s = buildIndexSummary({
      symbol: 'KSE100',
      name: 'KSE-100 Index',
      daily: [row(TODAY, 167970.65, 169830.1135, 232943686), row(PREV, 170511.85)],
    });

    expect(s.value).toBe(167970.65);
    expect(s.previousClose).toBe(170511.85);
    expect(s.change).toBeCloseTo(-2541.2, 4);
    expect(s.changePercent).toBeCloseTo(-1.4903, 3);
    expect(s.lastTradeDate).toEqual(new Date(TODAY));
    expect(s.open).toBe(169830.1135);
    expect(s.volume).toBe(232943686);
    // The DPS index series carries no high/low — reported as null, never fabricated.
    expect(s.high).toBeNull();
    expect(s.low).toBeNull();
  });

  it('reports null change when there is no earlier close to compare against', () => {
    const s = buildIndexSummary({ symbol: 'KSE100', name: 'KSE-100 Index', daily: [row(TODAY, 167970.65)] });
    expect(s.value).toBe(167970.65);
    expect(s.previousClose).toBeNull();
    expect(s.change).toBeNull();
    expect(s.changePercent).toBeNull();
  });

  it('returns nulls when never synced', () => {
    const s = buildIndexSummary({ symbol: 'KSE100', name: 'KSE-100 Index', daily: [] });
    expect(s).toMatchObject({ value: null, change: null, changePercent: null, previousClose: null, lastTradeDate: null });
  });

  it('prefers a newer intraday reading and compares it with the last daily close', () => {
    const liveAt = '2026-09-14T09:30:00.000Z'; // mid-session, before the daily close row exists
    const s = buildIndexSummary({
      symbol: 'KSE100',
      name: 'KSE-100 Index',
      daily: [row(PREV, 170511.85)],
      live: { value: 171000.5, at: new Date(liveAt) },
    });

    expect(s.value).toBe(171000.5);
    expect(s.lastTradeDate).toEqual(new Date(liveAt));
    expect(s.previousClose).toBe(170511.85);
    expect(s.change).toBeCloseTo(488.65, 2);
    // No daily row for the live day yet, so open/volume fall through to the latest row.
    expect(s.open).toBeNull();
  });

  it('keeps previousClose one day back when the live day already has a daily row', () => {
    const liveAt = '2026-09-14T12:30:00.000Z'; // newer than the day's own daily row
    const s = buildIndexSummary({
      symbol: 'KSE100',
      name: 'KSE-100 Index',
      daily: [row(TODAY, 167970.65, 169830.1135, 1000), row(PREV, 170511.85)],
      live: { value: 168500, at: new Date(liveAt) },
    });

    expect(s.value).toBe(168500);
    expect(s.previousClose).toBe(170511.85); // not today's own close
    expect(s.open).toBe(169830.1135); // today's open
    expect(s.volume).toBe(1000); // today's volume
  });

  it('ignores a stale intraday reading in favour of the newer daily close', () => {
    const s = buildIndexSummary({
      symbol: 'KSE100',
      name: 'KSE-100 Index',
      daily: [row(TODAY, 167970.65), row(PREV, 170511.85)],
      live: { value: 1, at: new Date('2026-09-12T10:00:00.000Z') },
    });
    expect(s.value).toBe(167970.65);
    expect(s.lastTradeDate).toEqual(new Date(TODAY));
  });
});

describe('toHistoryItem', () => {
  it('maps a daily row into the stock history shape', () => {
    const item = toHistoryItem(row('2026-09-14T11:00:00.000Z', 167970.65, 169830.1135, 232943686));
    expect(item).toEqual({
      lastTradeDate: new Date('2026-09-14T11:00:00.000Z'),
      currentPrice: 167970.65,
      close: 167970.65,
      open: 169830.1135,
      high: null,
      low: null,
      volume: 232943686,
    });
  });

  it('keeps null open/volume null', () => {
    const item = toHistoryItem(row('2026-09-13T11:00:00.000Z', 170511.85));
    expect(item.open).toBeNull();
    expect(item.volume).toBeNull();
  });
});

describe('liveReading', () => {
  it('requires both a value and a timestamp', () => {
    expect(liveReading(null, new Date())).toBeNull();
    expect(liveReading(170000, null)).toBeNull();
    expect(liveReading({ toString: () => '170000.5' }, new Date('2026-09-14T09:00:00.000Z'))).toEqual({
      value: 170000.5,
      at: new Date('2026-09-14T09:00:00.000Z'),
    });
  });
});
