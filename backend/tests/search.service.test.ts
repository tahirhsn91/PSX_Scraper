/**
 * Regression tests for PSX_Scraper#20.
 *
 * `GET /api/v1/search` dropped the `sector` that `stockRepository.search()` already
 * returns. PSX_Portfolio_Manager's own search provider maps the field as
 * `r.sector ?? 'Unknown'`, and its Add Holding form writes that straight into a
 * <Select> whose options are its static sector list — so the dropdown rendered empty
 * and the sector had to be picked by hand. The payload is the contract; these tests
 * pin it.
 *
 * `../src/config` is mocked because `src/config/env.ts` calls `process.exit(1)` when
 * DATABASE_URL/REDIS_URL are absent, and `../src/services/cache` is mocked so no
 * ioredis client or network is involved.
 */

jest.mock('../src/config', () => ({ env: { SEARCH_CACHE_TTL: 45 } }));

jest.mock('../src/services/cache', () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
}));

jest.mock('../src/repositories/deletedSymbol.repository', () => ({
  deletedSymbolRepository: { record: jest.fn(), forget: jest.fn(), isDeleted: jest.fn(), all: jest.fn() },
}));

jest.mock('../src/repositories/stock.repository', () => ({
  stockRepository: { search: jest.fn() },
}));

import { searchService } from '../src/services/search.service';
import { stockRepository, type StockListItem } from '../src/repositories/stock.repository';
import { cacheGet, cacheSet } from '../src/services/cache';
import type { SearchResponse } from '../src/services/search.service';

const search = stockRepository.search as unknown as jest.Mock;
const cacheGetMock = cacheGet as unknown as jest.Mock;
const cacheSetMock = cacheSet as unknown as jest.Mock;

const row = (over: Partial<StockListItem> = {}): StockListItem => ({
  id: 'id-1',
  symbol: 'FFC',
  companyName: 'Fauji Fertilizer Company Limited',
  sector: 'FERTILIZER',
  currentPrice: 540.41,
  changePercent: 0.99,
  volume: 582743,
  week52High: 685,
  week52Low: 441.7,
  lastTradeDate: new Date('2026-09-15T15:31:27.071Z'),
  lastSyncedAt: new Date('2026-09-15T15:31:27.153Z'),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  cacheGetMock.mockResolvedValue(null);
  cacheSetMock.mockResolvedValue(undefined);
});

describe('searchService.search', () => {
  it('carries the scraped sector through to every result', async () => {
    search.mockResolvedValue([
      row(),
      row({ id: 'id-2', symbol: 'MARI', companyName: 'Mari Energies Limited', sector: 'OIL & GAS EXPLORATION COMPANIES' }),
    ]);

    const payload = await searchService.search('eng', 20);

    expect(payload.results.map((r) => r.sector)).toEqual([
      'FERTILIZER',
      'OIL & GAS EXPLORATION COMPANIES',
    ]);
    // PSX's own casing is passed through untouched — the client normalises it.
    expect(payload.results[0]).toMatchObject({
      symbol: 'FFC',
      companyName: 'Fauji Fertilizer Company Limited',
      sector: 'FERTILIZER',
      currentPrice: 540.41,
    });
  });

  it('reports a never-scraped sector as null, never a placeholder', async () => {
    search.mockResolvedValue([row({ symbol: 'NEWCO', sector: null })]);

    const payload = await searchService.search('newco');

    expect(payload.results[0]?.sector).toBeNull();
  });

  it('stores the sector in the cached payload', async () => {
    search.mockResolvedValue([row()]);

    await searchService.search('ffc');

    expect(cacheSetMock).toHaveBeenCalledTimes(1);
    const [key, cached, ttl] = cacheSetMock.mock.calls[0] as [string, SearchResponse, number];
    expect(key).toBe('search:v2:ffc:20');
    expect(cached.results[0]?.sector).toBe('FERTILIZER');
    expect(ttl).toBe(45);
  });

  it('serves a cached payload without hitting the repository', async () => {
    const cached: SearchResponse = {
      query: 'ffc',
      results: [
        {
          symbol: 'FFC',
          companyName: null,
          sector: 'FERTILIZER',
          currentPrice: null,
          lastSyncedAt: null,
          lastTradeDate: null,
        },
      ],
    };
    cacheGetMock.mockResolvedValue(cached);

    await expect(searchService.search('ffc')).resolves.toEqual(cached);
    expect(search).not.toHaveBeenCalled();
  });

  it('short-circuits an empty term', async () => {
    await expect(searchService.search('   ')).resolves.toEqual({ query: '', results: [] });
    expect(search).not.toHaveBeenCalled();
  });
});
