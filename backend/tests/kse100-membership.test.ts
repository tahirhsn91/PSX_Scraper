import { syncKse100Membership, KSE100_SYMBOL } from '../src/services/kse100Membership.service';
import { fetchKse100 } from '../src/scrapers/scstradeKse100.scraper';
import { indexConstituentRepository } from '../src/repositories/indexConstituent.repository';
import { prisma } from '../src/database/prisma';

/**
 * The membership pass decides what page one of the dashboard shows, so what it does with each
 * kind of row matters more than its happy path:
 *
 *  - a symbol the index publishes that we do not track is *reported*, never added (adding it here
 *    would be a second, silent discovery path — and would resurrect a symbol removed on purpose);
 *  - the member set is replaced, not merged, so a company that leaves the index leaves the group;
 *  - positions follow the source's own order, so the list can be presented in it later.
 */
jest.mock('../src/scrapers/scstradeKse100.scraper', () => ({
  fetchKse100: jest.fn(),
  SCSTRADE_KSE100_SOURCE: 'scstrade-kse100',
}));
jest.mock('../src/repositories/indexConstituent.repository', () => ({
  indexConstituentRepository: {
    replaceForIndex: jest.fn(),
    groupCounts: jest.fn(),
    listForIndex: jest.fn(),
  },
}));
jest.mock('../src/database/prisma', () => ({
  prisma: {
    marketIndex: { upsert: jest.fn(), update: jest.fn() },
    stock: { findMany: jest.fn() },
  },
}));

const mockedFetch = fetchKse100 as jest.MockedFunction<typeof fetchKse100>;
const mockedReplace = indexConstituentRepository.replaceForIndex as jest.MockedFunction<
  typeof indexConstituentRepository.replaceForIndex
>;
const mockedPrisma = prisma as unknown as {
  marketIndex: { upsert: jest.Mock; update: jest.Mock };
  stock: { findMany: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.marketIndex.upsert.mockResolvedValue({ id: 'index-1' });
  mockedPrisma.marketIndex.update.mockResolvedValue({});
  mockedReplace.mockResolvedValue({ added: 2, removed: 0, kept: 0 });
});

describe('syncKse100Membership', () => {
  it('resolves the published symbols to tracked stocks and keeps the source order as position', async () => {
    mockedFetch.mockResolvedValue([
      { symbol: 'ABL', name: 'Allied Bank Ltd.' },
      { symbol: 'OGDC', name: 'Oil & Gas Development Co. Ltd.' },
    ]);
    mockedPrisma.stock.findMany.mockResolvedValue([
      { id: 'stock-ogdc', symbol: 'OGDC' },
      { id: 'stock-abl', symbol: 'ABL' },
    ]);

    const summary = await syncKse100Membership();

    expect(mockedReplace).toHaveBeenCalledWith('index-1', [
      { stockId: 'stock-abl', name: 'Allied Bank Ltd.', position: 1 },
      { stockId: 'stock-ogdc', name: 'Oil & Gas Development Co. Ltd.', position: 2 },
    ]);
    expect(summary).toMatchObject({
      index: KSE100_SYMBOL,
      fetched: 2,
      matched: 2,
      unknown: [],
      added: 2,
      removed: 0,
      kept: 0,
    });
  });

  it('reports a published symbol we do not track instead of adding it', async () => {
    mockedFetch.mockResolvedValue([
      { symbol: 'ABL', name: 'Allied Bank Ltd.' },
      { symbol: 'HGFA', name: 'HBL Growth Fund' },
    ]);
    mockedPrisma.stock.findMany.mockResolvedValue([{ id: 'stock-abl', symbol: 'ABL' }]);

    const summary = await syncKse100Membership();

    // The untracked symbol reaches no writer: only the matched row is handed to the repository.
    expect(mockedReplace).toHaveBeenCalledWith('index-1', [
      { stockId: 'stock-abl', name: 'Allied Bank Ltd.', position: 1 },
    ]);
    expect(summary.unknown).toEqual(['HGFA']);
    expect(summary.matched).toBe(1);
  });

  it('marks the index as synced so a stale member list is visible in the data', async () => {
    mockedFetch.mockResolvedValue([{ symbol: 'ABL', name: 'Allied Bank Ltd.' }]);
    mockedPrisma.stock.findMany.mockResolvedValue([{ id: 'stock-abl', symbol: 'ABL' }]);

    await syncKse100Membership();

    expect(mockedPrisma.marketIndex.update).toHaveBeenCalledWith({
      where: { id: 'index-1' },
      data: { lastSyncedAt: expect.any(Date) },
    });
  });

  it('creates the index row when it is missing, so page one works on a fresh database', async () => {
    mockedFetch.mockResolvedValue([]);
    mockedPrisma.stock.findMany.mockResolvedValue([]);
    mockedReplace.mockResolvedValue({ added: 0, removed: 0, kept: 0 });

    await syncKse100Membership();

    expect(mockedPrisma.marketIndex.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { symbol: KSE100_SYMBOL },
        create: expect.objectContaining({ symbol: KSE100_SYMBOL }),
      }),
    );
  });

  it('reports what the pass changed, including removals', async () => {
    mockedFetch.mockResolvedValue([{ symbol: 'ABL', name: null }]);
    mockedPrisma.stock.findMany.mockResolvedValue([{ id: 'stock-abl', symbol: 'ABL' }]);
    mockedReplace.mockResolvedValue({ added: 0, removed: 1, kept: 98 });

    const summary = await syncKse100Membership();

    expect(summary).toMatchObject({ added: 0, removed: 1, kept: 98 });
  });
});
