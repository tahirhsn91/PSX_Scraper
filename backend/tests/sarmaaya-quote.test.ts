import {
  fetchSarmaayaQuotes,
  parseStockQuote,
  sarmaayaQuoteUrl,
  SARMAYA_QUOTE_SOURCE,
} from '../src/scrapers/sarmaayaQuote.scraper';
import { sourceBreaker } from '../src/utils/sourceBreaker';

/**
 * The per-symbol source is the poll's third leg: the market-wide ticker covers the board but not
 * the ETFs, the preference shares and the renamed tickers, and those are exactly the symbols that
 * used to wait for a browser pass. Its parsing rules are pinned here — a payload is either a whole
 * quote or it is dropped, and a placeholder range is not a range.
 *
 * The payload below is a real response for ABL, copied field for field.
 */
const abPayload = (over: Record<string, unknown> = {}): unknown => ({
  success: true,
  message: 'Stock fetched successfully',
  response: {
    isin: 'PK0083501012',
    name: 'Allied Bank Limited',
    symbol: 'ABL',
    close: 170.61,
    low: 170.05,
    high: 171.4,
    volume: 6611,
    change: 0.56,
    change_percentage: 0.33,
    provider: 'factset',
    date: '2026-09-23T06:38:29.322Z',
    high52: 215,
    low52: 152.05,
    sectorName: 'COMMERCIAL BANKS',
    ...over,
  },
});

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as unknown as Response;
const status = (code: number): Response =>
  ({ ok: false, status: code, text: async () => '' }) as unknown as Response;

describe('parseStockQuote', () => {
  it('maps the source payload to a quote on the session, carrying the day range it states', () => {
    const snapshot = parseStockQuote(abPayload(), 'ABL');

    expect(snapshot).toMatchObject({
      symbol: 'ABL',
      price: 170.61,
      change: 0.56,
      changePercent: 0.33,
      volume: 6611,
      high: 171.4,
      low: 170.05,
      open: null,
      // The source states no previous close, so none is invented.
      previousClose: null,
    });
    // The payload's `date` is the quote instant (06:38Z = 11:38 PKT), not midnight-UTC: the row
    // key is still 16:00 PKT, the same session row every other writer uses.
    expect(snapshot?.sessionDate.toISOString()).toBe('2026-09-23T11:00:00.000Z');
  });

  it('keeps a real zero and refuses a placeholder range', () => {
    const flat = parseStockQuote(
      abPayload({ change: 0, change_percentage: 0, volume: 0, high: 0, low: 0 }),
      'ABL',
    );

    expect(flat).toMatchObject({ change: 0, changePercent: 0, volume: 0, high: null, low: null });
  });

  it('reads numbers that arrive as strings, and blanks as nothing', () => {
    const quoted = parseStockQuote(abPayload({ close: '1,234.50', volume: '' }), 'ABL');

    expect(quoted?.price).toBe(1234.5);
    expect(quoted?.volume).toBeNull();
  });

  it('drops a payload that cannot be a quote instead of guessing', () => {
    const cases: unknown[] = [
      {},
      { response: null },
      { response: 'nope' },
      { response: [1, 2] },
      abPayload({ close: 0 }),
      abPayload({ close: null }),
      abPayload({ date: null }),
      abPayload({ symbol: null, date: 'not-a-date' }),
    ];

    for (const body of cases) {
      expect(parseStockQuote(body, 'ABL')).toBeNull();
    }
  });

  it('falls back to the requested symbol when the payload omits one', () => {
    const snapshot = parseStockQuote(abPayload({ symbol: null }), 'abl');

    expect(snapshot?.symbol).toBe('ABL');
  });

  it('files a quote taken after the Karachi day rolls over on the next session', () => {
    // 20:30Z is 01:30 PKT the following day — a UTC slice would file it a day early.
    const snapshot = parseStockQuote(abPayload({ date: '2026-09-23T20:30:00.000Z' }), 'ABL');

    expect(snapshot?.sessionDate.toISOString()).toBe('2026-09-24T11:00:00.000Z');
  });
});

describe('fetchSarmaayaQuotes', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    sourceBreaker.reset();
    fetchMock.mockReset();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('requests one symbol at a time, within the cap it is given', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      ok(abPayload({ symbol: url.split('/').pop() })),
    );

    const result = await fetchSarmaayaQuotes(['ABL', 'OGDC', 'ACIETF', 'AGLNCP'], { max: 2, concurrency: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.snapshots.map((s) => s.symbol).sort()).toEqual(['ABL', 'OGDC']);
    // The excess is refused, not fired: the ticker is the bulk path and this leg only fills gaps.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      sarmaayaQuoteUrl('ABL'),
      sarmaayaQuoteUrl('OGDC'),
    ]);
  });

  it('treats a 404 as an answer for that symbol, never an availability failure', async () => {
    fetchMock.mockImplementation(async () => status(404));

    for (let run = 0; run < 6; run += 1) {
      const result = await fetchSarmaayaQuotes(['ZZNONE'], { max: 5 });
      expect(result.snapshots).toHaveLength(0);
      expect(result.failures).toEqual([{ symbol: 'ZZNONE', error: 'http=404' }]);
    }

    // Six consecutive "no such symbol" answers say nothing about the host being up.
    expect(sourceBreaker.isCoolingDown(SARMAYA_QUOTE_SOURCE)).toBe(false);
  });

  it('trips the breaker when the host itself is failing', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNRESET'));

    for (let run = 0; run < 5; run += 1) {
      await fetchSarmaayaQuotes(['ABL'], { max: 5 });
    }

    expect(sourceBreaker.isCoolingDown(SARMAYA_QUOTE_SOURCE)).toBe(true);
    // And a cooling source is not asked again: the next tick refuses before a request leaves.
    await expect(fetchSarmaayaQuotes(['ABL'], { max: 5 })).rejects.toThrow(/sarmaaya-quote/);
  });

  it('asks nothing when the cap is zero', async () => {
    const result = await fetchSarmaayaQuotes(['ABL', 'OGDC'], { max: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.snapshots).toHaveLength(0);
  });
});
