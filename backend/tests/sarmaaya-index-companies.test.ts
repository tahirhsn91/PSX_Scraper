import {
  fetchIndexConstituents,
  parseIndexCompanies,
} from '../src/scrapers/sarmaayaIndexCompanies.scraper';

/**
 * The constituents route is the index page's own data source, and two of its habits are easy to get
 * wrong in a way nobody notices until the dashboard column reads wrong:
 *
 *  - it nests its rows at `response.data`
 *  - it publishes *placeholder* rows — every figure zero — for securities it has no reading for. A `0`
 *    there would render as "this stock moved the index by nothing", which is a different claim from
 *    the truth ("nobody published a contribution for it"), so those rows must come through as null.
 *
 * A genuine zero (a stock in the index whose price did not move the index) must survive as 0, and the
 * two are told apart by the row's own price.
 */

/** One row as the endpoint really answers: ~21 fields, six of which we read. */
const row = (over: Record<string, unknown> = {}) => ({
  symbol: 'KTML',
  weights: 0.23,
  points: 4.06,
  curr: 41.46,
  change: 0.12,
  changePercent: 0.29,
  volume: 1_000,
  marketCap: 123_456,
  logo: 'logo.svg',
  isShariah: true,
  ...over,
});

const payload = (rows: unknown) => ({ success: true, message: 'Success', response: { data: rows } });

/** The parser's only row, failing the test if it did not return exactly one. */
function first(rows: ReturnType<typeof parseIndexCompanies>) {
  const [only] = rows;
  if (!only || rows.length !== 1) throw new Error(`expected exactly one reading, got ${rows.length}`);
  return only;
}

describe('parseIndexCompanies', () => {
  it('reads the contribution fields and ignores the payload furniture', () => {
    const parsed = first(parseIndexCompanies(payload([row()])));
    expect(parsed).toEqual({
      symbol: 'KTML',
      points: 4.06,
      weight: 0.23,
      level: 41.46,
      change: 0.12,
      changePercent: 0.29,
      marketCap: 123_456,
      logo: 'logo.svg',
    });
  });

  it('keeps a real logo URL and nulls an absent one', () => {
    const withLogo = first(parseIndexCompanies(payload([row()]))).logo;
    expect(withLogo).toBe('logo.svg');
    const withoutLogo = first(parseIndexCompanies(payload([row({ logo: null })]))).logo;
    expect(withoutLogo).toBeNull();
    const blankLogo = first(parseIndexCompanies(payload([row({ logo: '' })]))).logo;
    expect(blankLogo).toBeNull();
  });

  it('reports no reading for a placeholder row rather than a zero', () => {
    // The shape the source really sends for a constituent it has no figures for: every number zero.
    const parsed = first(
      parseIndexCompanies(payload([row({ points: 0, weights: 0, curr: 0, change: 0, changePercent: 0, marketCap: 0 })])),
    );
    expect(parsed.points).toBeNull();
    expect(parsed.weight).toBeNull();
    expect(parsed.level).toBeNull();
    expect(parsed.marketCap).toBeNull();
  });

  it('keeps a genuine zero contribution, which is told apart by the row carrying a price', () => {
    const parsed = first(parseIndexCompanies(payload([row({ points: 0, weights: 0.4, curr: 42.19 })])));
    expect(parsed.points).toBe(0);
    expect(parsed.level).toBe(42.19);
  });

  it('takes a repeated symbol once, so a map cannot silently lose a reading', () => {
    const parsed = first(parseIndexCompanies(payload([row(), row({ points: 99 })])));
    expect(parsed.points).toBe(4.06);
  });

  it('answers nothing for a payload it cannot read, instead of inventing rows', () => {
    expect(parseIndexCompanies(payload('not a list'))).toEqual([]);
    expect(parseIndexCompanies({ response: {} })).toEqual([]);
    expect(parseIndexCompanies(null)).toEqual([]);
  });
});

describe('fetchIndexConstituents', () => {
  /** A stub that answers the pages given, then records how many requests were made. */
  function stubFetch(pages: Array<{ ok: boolean; status?: number; body?: unknown }>) {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      const page = pages[calls.length - 1] ?? { ok: false, status: 404 };
      return {
        ok: page.ok,
        status: page.status ?? (page.ok ? 200 : 500),
        json: async () => page.body,
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  const fullPage = () => Array.from({ length: 100 }, (_v, i) => row({ symbol: `S${String(i).padStart(3, '0')}` }));

  it('walks the pages until a short one, at 100 rows a request', async () => {
    const { fetchImpl, calls } = stubFetch([
      { ok: true, body: payload(fullPage()) },
      { ok: true, body: payload([row({ symbol: 'KTML' })]) },
    ]);
    const readings = await fetchIndexConstituents('KSE100', { fetchImpl });
    expect(readings).toHaveLength(101);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/api/indices/KSE100/companies?page=1&limit=100');
    expect(calls[1]).toContain('page=2');
  });

  it('keeps what it read when a later page fails, so a partial set still refreshes', async () => {
    const { fetchImpl } = stubFetch([
      { ok: true, body: payload(fullPage()) },
      { ok: false, status: 502 },
    ]);
    const readings = await fetchIndexConstituents('ALLSHR', { fetchImpl });
    expect(readings).toHaveLength(100);
  });

  it('fails loudly when the first page fails — that is a source outage, not an empty index', async () => {
    const { fetchImpl } = stubFetch([{ ok: false, status: 404 }]);
    await expect(fetchIndexConstituents('KSE100', { fetchImpl })).rejects.toThrow(/HTTP 404/);
  });
});
