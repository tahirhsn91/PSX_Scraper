import { fetchPsxIndices, parseSarmaayaIndices } from '../src/scrapers/psxIndices.scraper';

/**
 * The board read must not be skippable, and one unreachable page must not be able to freeze it.
 *
 * Measured on 2026-09-28: the exchange's market-summary page could not be read by the running
 * worker between 11:29 PKT and the close, so all 17 index rows kept that intraday reading and the
 * dashboard served KSE-100 as 170,300.62 against a published close of 170,425.62 — a level
 * presented as a close, with nothing on the row to say so. The chain below is what replaced it:
 * the source that stamps its readings leads, and the page that cannot is the last resort (#107).
 *
 * The payload shape is the live one, captured from https://beta-restapi.sarmaaya.pk/api/indices.
 */
const board = (rows: unknown) =>
  JSON.stringify({ success: true, message: 'Success', response: { data: rows } });

const ROWS = [
  { symbol: 'KSE100', curr: 170425.62, change: -339.6, changePercent: -0.2 },
  { symbol: 'KMI30', curr: 244101.85, change: -289.45, changePercent: -0.12 },
  // The board repeats a row; it must still be one index.
  { symbol: 'KSE100', curr: 170425.62, change: -339.6, changePercent: -0.2 },
];

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("Sarmaaya's board as the index fallback", () => {
  it('reads symbol, level, change and percent from the payload', () => {
    const parsed = parseSarmaayaIndices(JSON.parse(board(ROWS)));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      symbol: 'KSE100',
      level: 170425.62,
      change: -339.6,
      changePercent: -0.2,
      direction: 'down',
    });
    expect(parsed[1]).toMatchObject({ symbol: 'KMI30', level: 244101.85 });
  });

  it('skips a row with no level instead of storing a fabricated zero', () => {
    const parsed = parseSarmaayaIndices(
      JSON.parse(
        board([
          { symbol: 'KSE100', curr: 170425.62, change: -339.6, changePercent: -0.2 },
          { symbol: 'BROKEN', curr: null, change: 1, changePercent: 0.1 },
          { symbol: 'ALSONULL', change: 1, changePercent: 0.1 },
        ]),
      ),
    );

    expect(parsed.map((i) => i.symbol)).toEqual(['KSE100']);
  });

  it('keeps a missing change null rather than recomputing one', () => {
    const parsed = parseSarmaayaIndices(JSON.parse(board([{ symbol: 'KSE100', curr: 170425.62 }])));

    expect(parsed[0]?.change).toBeNull();
    expect(parsed[0]?.changePercent).toBeNull();
    expect(parsed[0]?.direction).toBe('flat');
  });

  it('reads nothing out of a payload that is not the board shape', () => {
    expect(parseSarmaayaIndices(null)).toEqual([]);
    expect(parseSarmaayaIndices({})).toEqual([]);
    expect(parseSarmaayaIndices({ response: { data: 'nope' } })).toEqual([]);
  });

  it('leads with the board that can prove when it read, and never reaches the exchange’s page when a Sarmaaya source answers', async () => {
    const urls: string[] = [];
    global.fetch = (async (url: unknown) => {
      const target = String(url);
      urls.push(target);
      if (target.includes('/api/dashboard/market-view')) {
        return { ok: false, status: 503, text: async () => '' } as unknown as Response;
      }
      if (target.includes('beta-restapi.sarmaaya.pk')) {
        return { ok: true, status: 200, json: async () => JSON.parse(board(ROWS)) } as unknown as Response;
      }
      throw new Error(`unexpected url ${target}`);
    }) as unknown as typeof global.fetch;

    const parsed = await fetchPsxIndices();

    // In order: the live board, then the sibling board, and the exchange's page only if both refuse —
    // it is the one source that cannot say when it read (#107).
    expect(urls[0]).toContain('/api/dashboard/market-view');
    expect(urls[1]).toContain('/api/indices');
    expect(urls.some((u) => u.includes('psx.com.pk'))).toBe(false);
    expect(parsed.find((i) => i.symbol === 'KSE100')?.level).toBe(170425.62);
    expect(parsed).toHaveLength(2);
  });

  it('reports the leading source’s own failure when every source fails', async () => {
    global.fetch = (async () => {
      throw new Error('ENETUNREACH');
    }) as unknown as typeof global.fetch;

    // The lead's reason, not the last leg's: a fallback must not hide the original failure.
    await expect(fetchPsxIndices()).rejects.toThrow(/sarmaaya market-view unreachable/);
  });
});
