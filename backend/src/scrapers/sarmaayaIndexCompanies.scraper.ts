import { SCRAPER_USER_AGENT } from '../utils/userAgent';

/**
 * One index's constituents with their live contribution to it.
 *
 * `GET /api/indices/{SYMBOL}/companies?page=N&limit=100` on sarmaaya's rest host is the endpoint the
 * index page itself renders: the same rows the exchange's contribution table shows, with `points`
 * (index points this stock contributed, signed) and `weights` (its share of the index, percent)
 * beside `curr`, `change`, `changePercent` and `marketCap`.
 *
 * Three things this route teaches, each learned by probing rather than guessing:
 *
 * - **`limit` is capped at 100.** A larger value (500, 600) answers `404 Cannot GET …`, which is
 *   indistinguishable from a missing route on this API — so the page size is 100 and we paginate.
 * - **The pagination total counts rows, not symbols.** ALLSHR answers 1,270 rows over 13 pages for an
 *   index our own member list puts at 486; the extra rows are securities the index does not carry, so
 *   the caller matches by symbol and ignores the rest rather than trusting a count.
 * - **A published row can carry no reading**: `points`, `weights`, `curr`, `change` and `marketCap`
 *   all `0`. That is "not published", not "did not move", and the parser reports it as null (`null`
 *   would render as a dash) instead of a `0.00` that would claim the stock contributed nothing.
 */

const BASE = 'https://beta-restapi.sarmaaya.pk';
const PAGE_SIZE = 100;
/** The route's own ceiling on pages we will walk for one index before giving up. */
const MAX_PAGES = 20;

export interface IndexConstituentReading {
  symbol: string;
  /** Index points contributed, signed. Null when the payload carried no reading for the row. */
  points: number | null;
  /** Share of the index in percent. Null when the payload carried no reading for the row. */
  weight: number | null;
  /** The constituent's price in the same reading. Null when the payload carried no reading. */
  level: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  /** The constituent's company logo URL, or null when the board publishes none for it. */
  logo: string | null;
}

/** A number the source published, or null — never a coerced 0 for something it did not send. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a row carries a reading at all.
 *
 * The source publishes placeholder rows — `points`, `weights`, `curr` and `marketCap` all zero — for
 * securities it has no figures for. A genuine zero contribution is only meaningful beside a real
 * price, so a row with no price is treated as unpublised whatever its `points` says.
 */
function isPublished(row: Record<string, unknown>): boolean {
  const level = num(row.curr);
  const cap = num(row.marketCap);
  const weight = num(row.weights);
  if (level === 0 && cap === 0 && weight === 0) return false;
  return true;
}

/**
 * Parse one page of the constituents route. Exported for its test: the payload is a list under
 * `response.data`, and the parser must not invent a reading for a placeholder row.
 */
export function parseIndexCompanies(payload: unknown): IndexConstituentReading[] {
  const response = (payload as { response?: unknown } | null)?.response;
  const data = (response as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) return [];

  const rows: IndexConstituentReading[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    const row = entry as Record<string, unknown>;
    const symbol = String(row.symbol ?? '').trim().toUpperCase();
    // A repeated symbol would make the caller's map lose one reading silently.
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const published = isPublished(row);
    rows.push({
      symbol,
      points: published ? num(row.points) : null,
      weight: published ? num(row.weights) : null,
      level: published ? num(row.curr) : null,
      change: published ? num(row.change) : null,
      changePercent: published ? num(row.changePercent) : null,
      marketCap: published ? num(row.marketCap) : null,
      // A logo is not a reading: a placeholder row (all-zero figures) still carries its logo, so
      // this is read regardless of `published`. Only a non-empty string URL is kept — the board
      // answers `null` for securities it has no artwork for (ETFs, preference shares).
      logo: typeof row.logo === 'string' && row.logo.trim() !== '' ? row.logo.trim() : null,
    });
  }
  return rows;
}

/**
 * Every constituent of `indexSymbol` with its contribution, walking the route's pages.
 *
 * A page that answers non-200 stops the walk and keeps what was read: the caller then has a partial
 * set rather than none, and the symbols it does not cover simply keep their previous reading.
 */
export async function fetchIndexConstituents(
  indexSymbol: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<IndexConstituentReading[]> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const doFetch = options.fetchImpl ?? fetch;
  const symbol = indexSymbol.trim().toUpperCase();
  const all: IndexConstituentReading[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${BASE}/api/indices/${encodeURIComponent(symbol)}/companies?page=${page}&limit=${PAGE_SIZE}`;
    const res = await doFetch(url, {
      headers: { 'User-Agent': SCRAPER_USER_AGENT, Accept: 'application/json', Referer: 'https://sarmaaya.pk/' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`sarmaaya index constituents ${symbol}: HTTP ${res.status}`);
      break;
    }
    const rows = parseIndexCompanies(await res.json());
    const fresh = rows.filter((row) => !seen.has(row.symbol));
    for (const row of fresh) seen.add(row.symbol);
    all.push(...fresh);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}
