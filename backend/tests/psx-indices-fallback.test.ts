import { fetchPsxIndices, parseSarmaayaIndices } from '../src/scrapers/psxIndices.scraper';

/**
 * The board read must not be skippable, and no single source may freeze it.
 *
 * Measured on 2026-09-28: the exchange's market-summary page served an 11:29 PKT reading at 15:17
 * PKT, so the rows kept that intraday level and the dashboard served KSE-100 as 170,300.62 against
 * a published close of 170,425.62 — a level presented as a close, with nothing on the row to say
 * so. Sarmaaya's board is the read that keeps moving, so it leads; the exchange's page is the
 * fallback, and fills any symbol the lead did not publish.
 *
 * The payload shape is the live one, captured from https://beta-restapi.sarmaaya.pk/api/indices.
 */
const board = (rows: unknown) =>
  JSON.stringify({ success: true, message: 'Success', response: { data: rows } });

/** The exchange carousel's markup, as the page serves it. */
const carousel = (rows: Array<[string, number]>) =>
  rows
    .map(
      ([symbol, level]) =>
        `<div class="item indices-single"><div class="col-xs-6"><h3>${symbol}</h3><h4>${level}</h4></div>` +
        `<div class="col-xs-6"><h5 class="up">1.00</h5><h6 class="up">(0.01%)</h6></div></div>`,
    )
    .join('');

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

/**
 * Serve Sarmaaya's board and/or the exchange's page, recording the URLs that were asked for.
 *
 * Sarmaaya answers on two legs — the live market view and the `/indices` board — and both are served
 * from one `sarmaaya` source, in each leg's own shape, so a test that takes Sarmaaya down takes both
 * down. `marketView: 'fail'` takes down only the lead, which is how the `/indices` leg is tested.
 */
function serving(sources: { marketView?: 'fail'; sarmaaya?: unknown; page?: string | 'fail' }, urls: string[]) {
  return (async (url: unknown) => {
    const target = String(url);
    urls.push(target);
    if (target.includes('/api/dashboard/market-view')) {
      if (sources.marketView === 'fail' || sources.sarmaaya === undefined) {
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      }
      const rows = (sources.sarmaaya as Array<Record<string, unknown>>).map((r) => ({
        symbol: r.symbol,
        close: r.curr,
        change: r.change,
        changePercentage: r.changePercent,
        updated_at: '2026-09-28T17:23:24.835Z',
      }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, response: { data: rows } }),
      } as unknown as Response;
    }
    if (target.includes('beta-restapi.sarmaaya.pk')) {
      if (sources.sarmaaya === undefined) {
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => JSON.parse(board(sources.sarmaaya)) } as unknown as Response;
    }
    if (target.includes('psx.com.pk')) {
      if (sources.page === 'fail') {
        return { ok: false, status: 503, text: async () => '' } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => sources.page ?? '' } as unknown as Response;
    }
    throw new Error(`unexpected url ${target}`);
  }) as unknown as typeof global.fetch;
}

describe("Sarmaaya's board: what it carries", () => {
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
});

describe('the board read: Sarmaaya leads, the exchange page fills and falls back', () => {
  it('leads with the live market view: one call, every index, no page size to get wrong', async () => {
    const urls: string[] = [];
    global.fetch = serving({ sarmaaya: ROWS, page: carousel([['KMI30', 244101.85]]) }, urls);

    await fetchPsxIndices();

    expect(urls[0]).toContain('/api/dashboard/market-view');
    // The chain stops at the first read that answers, so a normal pass costs one request.
    expect(urls.filter((u) => u.includes('beta-restapi.sarmaaya.pk'))).toHaveLength(1);
  });

  it('asks the /indices leg for the whole board, not its first page', async () => {
    const urls: string[] = [];
    global.fetch = serving({ marketView: 'fail', sarmaaya: ROWS, page: carousel([['KMI30', 244101.85]]) }, urls);

    const parsed = await fetchPsxIndices();

    // The board paginates at ten rows while 17 indices are tracked, so a read without a limit is
    // short by seven — and those seven are never written.
    const sarmaaya = urls.find((u) => u.includes('/api/indices')) ?? '';
    expect(sarmaaya).toMatch(/[?&]limit=\d+/);
    expect(parsed).toHaveLength(2);
  });

  it('reads Sarmaaya first and takes the board from it', async () => {
    const urls: string[] = [];
    global.fetch = serving({ sarmaaya: ROWS, page: carousel([['KSE100', 170999.99]]) }, urls);

    const parsed = await fetchPsxIndices();

    expect(urls[0]).toContain('beta-restapi.sarmaaya.pk');
    expect(parsed).toHaveLength(2);
    // The lead's value wins for a symbol both sources carry.
    expect(parsed.find((i) => i.symbol === 'KSE100')?.level).toBe(170425.62);
    expect(parsed.find((i) => i.symbol === 'KMI30')?.level).toBe(244101.85);
  });

  it('takes a symbol the lead did not publish from the exchange page', async () => {
    const urls: string[] = [];
    global.fetch = serving(
      {
        sarmaaya: [{ symbol: 'KSE100', curr: 170425.62, change: -339.6, changePercent: -0.2 }],
        page: carousel([['KMI30', 244101.85]]),
      },
      urls,
    );

    const parsed = await fetchPsxIndices();

    expect(parsed.map((i) => i.symbol)).toEqual(['KSE100', 'KMI30']);
    expect(parsed[1]?.level).toBe(244101.85);
    expect(urls.some((u) => u.includes('psx.com.pk'))).toBe(true);
  });

  it("serves the lead's board when the exchange page cannot be read", async () => {
    const urls: string[] = [];
    global.fetch = serving({ sarmaaya: ROWS, page: 'fail' }, urls);

    const parsed = await fetchPsxIndices();

    expect(parsed).toHaveLength(2);
    expect(parsed.find((i) => i.symbol === 'KMI30')?.level).toBe(244101.85);
  });

  it('falls back to the exchange page when Sarmaaya cannot be read', async () => {
    const urls: string[] = [];
    global.fetch = serving({ page: carousel([['KSE100', 170425.62], ['KMI30', 244101.85]]) }, urls);

    const parsed = await fetchPsxIndices();

    // Sarmaaya is tried first even when it is the source that is down.
    expect(urls[0]).toContain('beta-restapi.sarmaaya.pk');
    expect(parsed.map((i) => i.symbol)).toEqual(['KSE100', 'KMI30']);
    expect(parsed[0]?.level).toBe(170425.62);
  });

  it('reports both reasons when neither source can be read', async () => {
    global.fetch = (async () => {
      throw new Error('ENETUNREACH');
    }) as unknown as typeof global.fetch;

    await expect(fetchPsxIndices()).rejects.toThrow(/sarmaaya indices unreachable/);
    await expect(fetchPsxIndices()).rejects.toThrow(/psx market-summary also failed/);
  });
});
