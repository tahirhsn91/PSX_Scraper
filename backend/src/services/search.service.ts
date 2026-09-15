import { stockRepository } from '../repositories/stock.repository';
import { cacheGet, cacheSet } from './cache';
import { env } from '../config';

/**
 * One `GET /api/v1/search` result — the wire contract other apps map onto their own
 * models (PSX_Portfolio_Manager reads `sector` to pre-fill a holding's sector).
 *
 * `lastSyncedAt` / `lastTradeDate` are `Date`s on a fresh read but ISO strings on a
 * cache hit — the payload round-trips through Redis as JSON — hence the union.
 */
export interface SearchResultItem {
  symbol: string;
  companyName: string | null;
  /** PSX's own casing (e.g. 'COMMERCIAL BANKS'); null when the symbol was never scraped. */
  sector: string | null;
  currentPrice: number | null;
  lastSyncedAt: string | Date | null;
  lastTradeDate: string | Date | null;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
}

export const searchService = {
  async search(q: string, limit = 20): Promise<SearchResponse> {
    const term = q.trim();
    if (term.length < 1) return { query: term, results: [] };
    // The payload-shape version in the key means an entry cached by an older build
    // (which carried no `sector`) can't be served for SEARCH_CACHE_TTL seconds after
    // the deploy that added it.
    const key = `search:v2:${term.toLowerCase()}:${limit}`;
    const cached = await cacheGet<SearchResponse>(key);
    if (cached) return cached;

    const rows = await stockRepository.search(term, limit);
    const payload = {
      query: term,
      results: rows.map((r) => ({
        symbol: r.symbol,
        companyName: r.companyName,
        // Null when the symbol has never been scraped — never substituted for a
        // placeholder: clients key their sector pickers off this value.
        sector: r.sector,
        currentPrice: r.currentPrice,
        lastSyncedAt: r.lastSyncedAt,
        lastTradeDate: r.lastTradeDate,
      })),
    };
    await cacheSet(key, payload, env.SEARCH_CACHE_TTL);
    return payload;
  },
};
