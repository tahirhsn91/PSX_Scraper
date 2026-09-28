import {
  CANDLE_COLUMNS,
  CLOSE_COLUMN_INDEX,
  HIGH_COLUMN_INDEX,
  LOW_COLUMN_INDEX,
  OPEN_COLUMN_INDEX,
  VOLUME_COLUMN_INDEX,
  fetchTradingViewCandles,
  parseTradingViewCandles,
} from '../src/scrapers/tradingViewCandles.scraper';

/**
 * The scanner's answer for KSE-100, copied verbatim from the live endpoint on 2026-09-28 — the same
 * candle Sarmaaya's `close` and its own high/low agree with. This is the fixture every expectation is
 * derived from, so the column positions are pinned against the payload rather than against the code.
 */
const liveRow = () => ({
  s: 'PSX:KSE100',
  d: ['KSE 100 Index', 170991.1346, 171126.5234, 170120.4983, 170425.6242, null],
});

const payload = (rows: unknown[]) => ({ totalCount: rows.length, data: rows });

/** The one candle a single-row payload parses to. `[0]!` rather than a destructure: the suite runs
 * with `noUncheckedIndexedAccess`, where every indexed read is optional. */
const one = (rows: unknown[]) => parseTradingViewCandles(payload(rows))[0]!;

describe('the scanner column contract', () => {
  it('reads each leg from the position the live payload carries it in', () => {
    expect(CANDLE_COLUMNS[OPEN_COLUMN_INDEX]).toBe('open');
    expect(CANDLE_COLUMNS[HIGH_COLUMN_INDEX]).toBe('high');
    expect(CANDLE_COLUMNS[LOW_COLUMN_INDEX]).toBe('low');
    expect(CANDLE_COLUMNS[CLOSE_COLUMN_INDEX]).toBe('close');
    expect(CANDLE_COLUMNS[VOLUME_COLUMN_INDEX]).toBe('volume');
    expect(one([liveRow()])).toEqual({
      symbol: 'KSE100',
      open: 170991.1346,
      high: 171126.5234,
      low: 170120.4983,
      close: 170425.6242,
      volume: null,
    });
  });

  it('strips the exchange prefix and upper-cases the symbol', () => {
    const candle = one([{ s: 'psx:ogdc', d: ['OGDC', 316.5, 319.8, 315.3, 318.69, 1646464] }]);
    expect(candle.symbol).toBe('OGDC');
    expect(candle.volume).toBe(1646464);
  });

  it('keeps a stock candle whole — the live OGDC row, which reconciled with ours to the paisa', () => {
    const candle = one([
      { s: 'PSX:OGDC', d: ['Oil & Gas Development Co. Ltd.', 316.5, 319.8, 315.3, 318.69, 1646464] },
    ]);
    expect(candle).toMatchObject({ open: 316.5, high: 319.8, low: 315.3, close: 318.69 });
  });
});

describe('legs that are absent are gaps, never zeros', () => {
  it('leaves a null leg null instead of coercing it to zero', () => {
    // `Number(null)` is 0. A candle that never traded must not become a real-looking zero price.
    const candle = one([{ s: 'PSX:KSE100', d: ['KSE 100 Index', null, null, null, 170425.6242, null] }]);
    expect(candle.open).toBeNull();
    expect(candle.open).not.toBe(0);
    expect(candle.high).toBeNull();
    expect(candle.low).toBeNull();
    expect(candle.volume).toBeNull();
  });

  it('treats a zero or negative price as no reading, but a zero volume as a fact', () => {
    const candle = one([{ s: 'PSX:XYZ', d: ['XYZ', 0, -1, 'nonsense', 10, 0] }]);
    expect(candle.open).toBeNull();
    expect(candle.high).toBeNull();
    expect(candle.low).toBeNull();
    expect(candle.close).toBe(10);
    expect(candle.volume).toBe(0);
  });

  it('drops a row whose price legs are all absent — the scanner carries the ticker, not a candle', () => {
    expect(parseTradingViewCandles(payload([{ s: 'PSX:NOPE', d: ['NOPE', null, null, null, null, null] }]))).toEqual([]);
  });
});

describe('a malformed or surprising payload degrades to nothing', () => {
  it('answers empty for a payload that is not a row list', () => {
    expect(parseTradingViewCandles(null)).toEqual([]);
    expect(parseTradingViewCandles({})).toEqual([]);
    expect(parseTradingViewCandles({ data: 'nope' })).toEqual([]);
    expect(parseTradingViewCandles(payload([{ s: '', d: [1, 2, 3, 4, 5] }]))).toEqual([]);
  });

  it('keeps the first row when the scanner answers a ticker twice', () => {
    const rows = [
      { s: 'PSX:KSE100', d: ['KSE 100 Index', 170991.1346, 171126.5234, 170120.4983, 170425.6242, null] },
      { s: 'PSX:KSE100', d: ['KSE 100 Index', 1, 1, 1, 1, 1] },
    ];
    const candles = parseTradingViewCandles(payload(rows));
    expect(candles).toHaveLength(1);
    expect(candles[0]!.open).toBe(170991.1346);
  });
});

describe('fetching a universe in batches', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts one ticker set per batch and merges the answers', async () => {
    const seen: string[][] = [];
    global.fetch = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { symbols: { tickers: string[] } };
      seen.push(body.symbols.tickers);
      return {
        ok: true,
        json: async () =>
          payload(
            body.symbols.tickers.map((ticker, i) => ({
              s: ticker,
              d: [`${ticker} name`, 10 + i, 11 + i, 9 + i, 10.5 + i, 100 + i],
            })),
          ),
      };
    }) as unknown as typeof global.fetch;

    const symbols = Array.from({ length: 260 }, (_, i) => `S${i}`);
    const candles = await fetchTradingViewCandles(symbols);

    expect(seen).toHaveLength(2);
    expect(seen[0]!).toHaveLength(250);
    expect(seen[1]!).toHaveLength(10);
    expect(candles).toHaveLength(260);
  });

  it('answers empty rather than throwing when the scanner refuses, so nothing is written', async () => {
    global.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof global.fetch;
    await expect(fetchTradingViewCandles(['KSE100'])).resolves.toEqual([]);
  });

  it('survives a transport error on one batch', async () => {
    global.fetch = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof global.fetch;
    await expect(fetchTradingViewCandles(['KSE100'])).resolves.toEqual([]);
  });
});
