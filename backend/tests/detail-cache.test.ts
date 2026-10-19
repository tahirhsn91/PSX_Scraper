/**
 * Cache-aside for the two detail-view computations that were repeated per visitor:
 * a sector's peer distributions (identical for every stock in the sector) and a symbol's beta
 * (recomputed on every detail view, but moving only ~daily).
 *
 * `../src/config` is mocked because `env.ts` calls `process.exit(1)` when DATABASE_URL/REDIS_URL
 * are absent, and `../src/services/cache` is mocked so no ioredis client or network is involved.
 */

jest.mock('../src/config', () => ({
  env: { SECTOR_MEDIANS_CACHE_TTL: 3600, BETA_CACHE_TTL: 3600 },
}));

jest.mock('../src/services/cache', () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
}));

jest.mock('../src/services/beta.service', () => ({
  betaService: { forSymbol: jest.fn() },
}));

jest.mock('../src/repositories/fundamentals.repository', () => ({
  getSectorRatioRows: jest.fn(),
}));

import { getCachedSectorPeerStats, getCachedBeta } from '../src/services/detailCache';
import { cacheGet, cacheSet } from '../src/services/cache';
import { betaService, type BetaResult } from '../src/services/beta.service';
import { getSectorRatioRows } from '../src/repositories/fundamentals.repository';

const cacheGetMock = cacheGet as unknown as jest.Mock;
const cacheSetMock = cacheSet as unknown as jest.Mock;
const forSymbolMock = betaService.forSymbol as unknown as jest.Mock;
const ratioRowsMock = getSectorRatioRows as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  cacheGetMock.mockResolvedValue(null);
  cacheSetMock.mockResolvedValue(undefined);
});

describe('getCachedSectorPeerStats', () => {
  it('normalises the sector into the key and stores the distributions with the TTL', async () => {
    ratioRowsMock.mockResolvedValue([
      { peRatio: 20, roe: 5 },
      { peRatio: 10, roe: null },
    ]);

    await getCachedSectorPeerStats('TEXTILE SPINNING');

    expect(cacheSetMock).toHaveBeenCalledTimes(1);
    const [key, cached, ttl] = cacheSetMock.mock.calls[0] as [string, unknown, number];
    expect(key).toBe('sector-peers:v2:textile-spinning');
    expect(cached).toMatchObject({
      sector: 'TEXTILE SPINNING',
      distributions: { peRatio: [10, 20], roe: [5] },
    });
    expect(ttl).toBe(3600);
  });

  it('serves a cached value without hitting the repository', async () => {
    cacheGetMock.mockResolvedValue({ sector: 'TEXTILE SPINNING', distributions: { peRatio: [10, 20] } });

    await getCachedSectorPeerStats('TEXTILE SPINNING');

    expect(ratioRowsMock).not.toHaveBeenCalled();
    expect(cacheSetMock).not.toHaveBeenCalled();
  });
});

describe('getCachedBeta', () => {
  const beta: BetaResult = {
    value: 1.2345,
    window: {
      index: 'KSE100',
      label: '1Y',
      sessions: 250,
      observations: 200,
      from: '2025-01-02',
      to: '2025-12-31',
      minimum: 60,
    },
    method: 'beta = cov(...) / var(...)',
    reason: null,
  };

  it('stores beta under the uppercase symbol key with the TTL', async () => {
    forSymbolMock.mockResolvedValue(beta);

    await getCachedBeta('engro');

    expect(cacheSetMock).toHaveBeenCalledTimes(1);
    const [key, cached, ttl] = cacheSetMock.mock.calls[0] as [string, unknown, number];
    expect(key).toBe('beta:v1:ENGRO');
    expect(cached).toEqual(beta);
    expect(ttl).toBe(3600);
  });

  it('serves a cached value without recomputing', async () => {
    cacheGetMock.mockResolvedValue(beta);

    await getCachedBeta('engro');

    expect(forSymbolMock).not.toHaveBeenCalled();
    expect(cacheSetMock).not.toHaveBeenCalled();
  });
});
