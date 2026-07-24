import { stockRepository } from '../repositories/stock.repository';
import { cacheGet, cacheSet } from './cache';
import { env } from '../config';

export const searchService = {
  async search(q: string, limit = 20) {
    const term = q.trim();
    if (term.length < 1) return { query: term, results: [] };
    const key = `search:${term.toLowerCase()}:${limit}`;
    const cached = await cacheGet<{ query: string; results: unknown[] }>(key);
    if (cached) return cached;

    const rows = await stockRepository.search(term, limit);
    const payload = {
      query: term,
      results: rows.map((r) => ({
        symbol: r.symbol,
        companyName: r.companyName,
        currentPrice: r.currentPrice,
        lastSyncedAt: r.lastSyncedAt,
        lastTradeDate: r.lastTradeDate,
      })),
    };
    await cacheSet(key, payload, env.SEARCH_CACHE_TTL);
    return payload;
  },
};
