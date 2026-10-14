/**
 * The board pass writes an index's level, and a best-effort extra (the 52-week pair and market cap)
 * beside it. Those extra columns come from a second source and are explicitly allowed to fail — but
 * while they rode inside the same `marketIndex.upsert()` call as the level, one rejected column took
 * the whole invocation down: a Prisma client that did not know `week52High` answered
 * `Unknown argument week52High`, so every index's level, its session row and its repair were skipped
 * and the board sat at 2026-10-09 16:30 PKT for five days. Nothing but a failed job said so.
 *
 * These tests pin the contract that makes the promise true: the level is written whatever happens to
 * the stats, a refused stats write leaves the columns alone, and the refusal is reported rather than
 * swallowed.
 */
jest.mock('../src/config', () => ({ env: {} }));
jest.mock('../src/jobs/connection', () => ({ createRedisConnection: jest.fn() }));
jest.mock('../src/services/supplementaryIndices.service', () => ({
  registerSupplementaryIndices: jest.fn(async () => []),
}));
jest.mock('../src/services/marketCalendar.service', () => ({
  tradingDayState: jest.fn(async () => 'trading'),
}));
jest.mock('../src/repositories/index.repository', () => ({
  indexRepository: { upsertValues: jest.fn(async () => 1) },
}));
jest.mock('../src/scrapers/psxIndices.scraper', () => ({
  fetchPsxIndices: jest.fn(),
  fetchIndexNames: jest.fn(async () => ({})),
  fetchSarmaayaIndexStats: jest.fn(),
}));

const marketIndex = {
  upsert: jest.fn(),
  update: jest.fn(),
  findUnique: jest.fn(async () => ({ id: 'idx-1', name: 'KSE-100 Index' })),
};
const indexValue = {
  findUnique: jest.fn(async () => null),
  findFirst: jest.fn(async () => null),
  update: jest.fn(),
};
jest.mock('../src/database/prisma', () => ({
  prisma: {
    get marketIndex() {
      return marketIndex;
    },
    get indexValue() {
      return indexValue;
    },
  },
  disconnectPrisma: jest.fn(),
}));

import { scrapeIndices } from '../src/services/indexScrape.service';
import {
  fetchPsxIndices,
  fetchIndexNames,
  fetchSarmaayaIndexStats,
} from '../src/scrapers/psxIndices.scraper';
import { indexRepository } from '../src/repositories/index.repository';

const mockedParse = fetchPsxIndices as jest.MockedFunction<typeof fetchPsxIndices>;
const mockedStats = fetchSarmaayaIndexStats as jest.MockedFunction<typeof fetchSarmaayaIndexStats>;
const mockedNames = fetchIndexNames as jest.MockedFunction<typeof fetchIndexNames>;
const upsertValues = indexRepository.upsertValues as jest.MockedFunction<
  typeof indexRepository.upsertValues
>;

/** 10:00 PKT on a Wednesday — a session, so the fullest write path runs. */
const NOW = new Date('2026-10-14T05:00:00Z');

const parsedBoard = () => [
  {
    symbol: 'KSE100',
    name: 'KSE-100 Index',
    level: 170_000.5,
    change: 120.25,
    changePercent: 0.07,
    direction: 'up' as const,
    // Fresh enough to prove it is live, so the in-session freshness gate admits it.
    readAt: new Date(NOW.getTime() - 60_000),
    volume: 12_345,
  },
];

const statsBoard = () =>
  new Map([['KSE100', { high52: 191_032.73, low52: 144_119.44, marketCap: 4_635_170_322_694.43 }]]);

beforeEach(() => {
  jest.clearAllMocks();
  mockedNames.mockResolvedValue({});
  marketIndex.upsert.mockResolvedValue({ id: 'idx-1' });
  marketIndex.findUnique.mockResolvedValue({ id: 'idx-1', name: 'KSE-100 Index' });
  indexValue.findUnique.mockResolvedValue(null);
  indexValue.findFirst.mockResolvedValue(null);
  upsertValues.mockResolvedValue(1);
});

describe('the board pass and its best-effort stats', () => {
  it('still writes the level, the session row and the repair when the stats write is refused', async () => {
    mockedParse.mockResolvedValue(parsedBoard());
    mockedStats.mockResolvedValue(statsBoard());
    marketIndex.update.mockRejectedValue(new Error("Unknown argument `week52High`."));

    const result = await scrapeIndices(NOW);

    // The level is the board: it is written, and it does not carry the columns that can be refused.
    expect(marketIndex.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = marketIndex.upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(upsertArg.update.liveValue).toBeDefined();
    expect(upsertArg.update.liveAt).toEqual(NOW);
    expect(upsertArg.update).not.toHaveProperty('week52High');
    expect(upsertArg.create).not.toHaveProperty('marketCap');

    // The session row is still written — a metadata gap must not cost a session.
    expect(upsertValues).toHaveBeenCalledTimes(1);

    // The refusal is attempted, isolated, and reported.
    expect(marketIndex.update).toHaveBeenCalledTimes(1);
    expect(result.statsRefused).toEqual(['KSE100']);
    expect(result.updated).toBe(1);
  });

  it('writes the stats in their own statement and reports no refusal when they are accepted', async () => {
    mockedParse.mockResolvedValue(parsedBoard());
    mockedStats.mockResolvedValue(statsBoard());
    marketIndex.update.mockResolvedValue({ id: 'idx-1' });

    const result = await scrapeIndices(NOW);

    expect(marketIndex.update).toHaveBeenCalledWith({
      where: { id: 'idx-1' },
      data: {
        week52High: expect.anything(),
        week52Low: expect.anything(),
        marketCap: expect.anything(),
      },
    });
    expect(result.statsRefused).toBeUndefined();
    expect(marketIndex.upsert).toHaveBeenCalledTimes(1);
  });

  it('issues no stats statement at all when the source published none', async () => {
    mockedParse.mockResolvedValue(parsedBoard());
    mockedStats.mockResolvedValue(new Map());

    const result = await scrapeIndices(NOW);

    expect(marketIndex.update).not.toHaveBeenCalled();
    expect(result.statsRefused).toBeUndefined();
    expect(marketIndex.upsert).toHaveBeenCalledTimes(1);
  });
});
