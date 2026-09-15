/**
 * The guard that stops a price-less scrape from overwriting the last good reading.
 *
 * Before it existed, a merged result whose price block was all nulls was persisted as a new
 * `stock_prices` row; being the newest, it then became the value the API served — 9 of 23
 * symbols were serving `currentPrice: null` while their syncs were logged SUCCESS.
 *
 * `../src/config` is mocked because `src/config/env.ts` exits the process when
 * DATABASE_URL/REDIS_URL are absent, and `../src/database/prisma` so no client is built.
 */
jest.mock('../src/config', () => ({ env: {} }));
jest.mock('../src/database/prisma', () => ({ prisma: {}, disconnectPrisma: jest.fn() }));

import { hasUsablePrice } from '../src/repositories/scrapeResult.repository';
import type { PriceDTO } from '../src/types/dto';

const price = (over: Partial<PriceDTO> = {}): PriceDTO => ({
  currentPrice: 540.41,
  change: 5.3,
  changePercent: 0.99,
  volume: 582743,
  high: null,
  low: null,
  open: 537,
  close: 540.41,
  marketCap: null,
  lastTradeDate: '2026-09-15T11:00:00.000Z',
  ...over,
});

describe('hasUsablePrice', () => {
  it('accepts a block that carries a price', () => {
    expect(hasUsablePrice(price())).toBe(true);
  });

  it('rejects null', () => {
    expect(hasUsablePrice(null)).toBe(false);
  });

  it('rejects an all-null block (a page that rendered without its quote)', () => {
    expect(
      hasUsablePrice(
        price({
          currentPrice: null,
          change: null,
          changePercent: null,
          volume: null,
          open: null,
          close: null,
        }),
      ),
    ).toBe(false);
  });

  it('still accepts a price with every other field missing', () => {
    expect(hasUsablePrice(price({ change: null, changePercent: null, volume: null, open: null }))).toBe(
      true,
    );
  });
});
