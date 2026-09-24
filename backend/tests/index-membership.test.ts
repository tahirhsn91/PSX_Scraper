import { syncAllIndexMembership, syncIndexMembership } from '../src/services/indexMembership.service';
import { fetchIndexMembers } from '../src/scrapers/sarmaayaIndexMembers.scraper';
import { fetchKse100 } from '../src/scrapers/scstradeKse100.scraper';
import { indexConstituentRepository } from '../src/repositories/indexConstituent.repository';
import { prisma } from '../src/database/prisma';

/**
 * The all-index membership pass decides what the dashboard's index filter shows, so what matters
 * here is the routing and the per-index verdicts rather than the happy path:
 *
 *  - KSE100 keeps the exchange's own member site (it prints names, and its member list is page one)
 *    — the generic pass must never re-point it at the ticker;
 *  - every other index comes from the ticker, and its `name` is stored as null (the source has
 *    none) rather than invented;
 *  - a published symbol we do not track is *reported*, never added: the membership list is not a
 *    discovery path, and it would resurrect a symbol somebody removed on purpose;
 *  - one index failing does not cost the other sixteen their pass, and nothing is written for the
 *    failed one.
 */
jest.mock('../src/scrapers/sarmaayaIndexMembers.scraper', () => ({
  fetchIndexMembers: jest.fn(),
  SARMAYA_INDEX_MEMBERS_SOURCE: 'sarmaaya-index-members',
}));
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
    marketIndex: { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    stock: { findMany: jest.fn() },
  },
}));

const mockedMembers = fetchIndexMembers as jest.MockedFunction<typeof fetchIndexMembers>;
const mockedKse100 = fetchKse100 as jest.MockedFunction<typeof fetchKse100>;
const mockedReplace = indexConstituentRepository.replaceForIndex as jest.MockedFunction<
  typeof indexConstituentRepository.replaceForIndex
>;
const mockedPrisma = prisma as unknown as {
  marketIndex: { upsert: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  stock: { findMany: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  // The id is derived from the symbol so a pass over several indices cannot have its writes
  // conflated in the assertions below.
  mockedPrisma.marketIndex.upsert.mockImplementation((args: { where: { symbol: string } }) =>
    Promise.resolve({ id: `index-${args.where.symbol}` }),
  );
  mockedPrisma.marketIndex.update.mockResolvedValue({});
  mockedPrisma.marketIndex.findMany.mockResolvedValue([]);
  mockedPrisma.stock.findMany.mockResolvedValue([]);
  mockedReplace.mockResolvedValue({ added: 0, removed: 0, kept: 0 });
});

describe('syncIndexMembership', () => {
  it('resolves a published index to tracked stocks, keeping the source order as position', async () => {
    mockedMembers.mockResolvedValue([
      { symbol: 'AIRLINK', name: null },
      { symbol: 'OGDC', name: null },
    ]);
    mockedPrisma.stock.findMany.mockResolvedValue([
      { id: 'stock-ogdc', symbol: 'OGDC' },
      { id: 'stock-airlink', symbol: 'AIRLINK' },
    ]);
    mockedReplace.mockResolvedValue({ added: 2, removed: 0, kept: 0 });

    const summary = await syncIndexMembership('kmi30', 'KMI 30 Index');

    expect(mockedMembers).toHaveBeenCalledWith('KMI30');
    expect(mockedReplace).toHaveBeenCalledWith('index-KMI30', [
      { stockId: 'stock-airlink', name: null, position: 1 },
      { stockId: 'stock-ogdc', name: null, position: 2 },
    ]);
    expect(summary).toMatchObject({
      index: 'KMI30',
      fetched: 2,
      matched: 2,
      unknown: [],
      added: 2,
      removed: 0,
      kept: 0,
    });
    expect(mockedPrisma.marketIndex.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { symbol: 'KMI30' },
        create: expect.objectContaining({ symbol: 'KMI30', name: 'KMI 30 Index' }),
      }),
    );
    expect(mockedPrisma.marketIndex.update).toHaveBeenCalledWith({
      where: { id: 'index-KMI30' },
      data: { lastSyncedAt: expect.any(Date) },
    });
  });

  it('reports a published symbol we do not track instead of adding it', async () => {
    mockedMembers.mockResolvedValue([
      { symbol: 'AIRLINK', name: null },
      { symbol: 'HGFA', name: null },
    ]);
    mockedPrisma.stock.findMany.mockResolvedValue([{ id: 'stock-airlink', symbol: 'AIRLINK' }]);

    const summary = await syncIndexMembership('KMI30');

    // The untracked symbol reaches no writer: only the matched row is handed to the repository.
    expect(mockedReplace).toHaveBeenCalledWith('index-KMI30', [
      { stockId: 'stock-airlink', name: null, position: 1 },
    ]);
    expect(summary.unknown).toEqual(['HGFA']);
    expect(summary.matched).toBe(1);
  });

  it('refuses an empty published list instead of wiping the index', async () => {
    // The source answers `{success:true, response:[]}` for a symbol it has no list for (measured
    // against `?index=NOPE`), which is indistinguishable from a transient empty read. Membership is
    // a replace, so an empty list must never reach the writer.
    mockedMembers.mockResolvedValue([]);

    await expect(syncIndexMembership('KMI30')).rejects.toThrow(/no members for KMI30/);

    expect(mockedReplace).not.toHaveBeenCalled();
    expect(mockedPrisma.marketIndex.update).not.toHaveBeenCalled();
  });

  it('keeps KSE100 on the exchange member site — the ticker is never asked for it', async () => {
    mockedKse100.mockResolvedValue([{ symbol: 'ABL', name: 'Allied Bank Ltd.' }]);
    mockedPrisma.stock.findMany.mockResolvedValue([{ id: 'stock-abl', symbol: 'ABL' }]);

    const summary = await syncIndexMembership('kse100');

    expect(mockedKse100).toHaveBeenCalledTimes(1);
    expect(mockedMembers).not.toHaveBeenCalled();
    // The scstrade source's names survive — proof this ran the KSE-100 pass, not the ticker.
    expect(mockedReplace).toHaveBeenCalledWith('index-KSE100', [
      { stockId: 'stock-abl', name: 'Allied Bank Ltd.', position: 1 },
    ]);
    expect(summary.index).toBe('KSE100');
  });
});

describe('syncAllIndexMembership', () => {
  beforeEach(() => {
    mockedMembers.mockResolvedValue([{ symbol: 'AIRLINK', name: null }]);
    mockedPrisma.stock.findMany.mockResolvedValue([{ id: 'stock-airlink', symbol: 'AIRLINK' }]);
    mockedKse100.mockResolvedValue([{ symbol: 'ABL', name: 'Allied Bank Ltd.' }]);
  });

  it('walks every index, routing each one to its own source', async () => {
    mockedPrisma.marketIndex.findMany.mockResolvedValue([
      { symbol: 'KMI30', name: 'KMI 30 Index' },
      { symbol: 'KSE100', name: 'KSE-100 Index' },
    ]);

    const summary = await syncAllIndexMembership();

    expect(mockedMembers).toHaveBeenCalledWith('KMI30');
    expect(mockedKse100).toHaveBeenCalledTimes(1);
    expect(summary.indices).toBe(2);
    expect(summary.failed).toEqual([]);
    expect(summary.synced.map((s) => s.index)).toEqual(['KMI30', 'KSE100']);
  });

  it('keeps the KSE-100 in the walk even when market_indices has no row for it', async () => {
    // This pass replaced a job that ran the KSE-100 sync unconditionally; page one must not start
    // depending on the index scrape having populated the table first.
    mockedPrisma.marketIndex.findMany.mockResolvedValue([]);

    const summary = await syncAllIndexMembership();

    expect(mockedKse100).toHaveBeenCalledTimes(1);
    expect(summary.indices).toBe(1);
    expect(summary.synced[0]?.index).toBe('KSE100');
  });

  it('reports an index whose list came back empty, and writes nothing for it', async () => {
    mockedPrisma.marketIndex.findMany.mockResolvedValue([
      { symbol: 'OGTI', name: 'PSX Oil & Gas Tradable Sector Index' },
    ]);
    mockedMembers.mockResolvedValue([]);

    const summary = await syncAllIndexMembership();

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]?.index).toBe('OGTI');
    expect(summary.failed[0]?.error).toMatch(/no members for OGTI/);
    expect(summary.synced.map((s) => s.index)).toEqual(['KSE100']);
    // Only the KSE-100 was written; OGTI's member list is left exactly as it was.
    expect(mockedReplace).toHaveBeenCalledTimes(1);
  });

  it('reports a failing index and still syncs the rest, writing nothing for the failure', async () => {
    mockedPrisma.marketIndex.findMany.mockResolvedValue([
      { symbol: 'KMI30', name: 'KMI 30 Index' },
      { symbol: 'OGTI', name: 'PSX Oil & Gas Tradable Sector Index' },
      { symbol: 'KSE100', name: 'KSE-100 Index' },
    ]);
    mockedMembers.mockImplementation((symbol: string) =>
      symbol === 'OGTI'
        ? Promise.reject(new Error('Source site unavailable: sarmaaya-index-members'))
        : Promise.resolve([{ symbol: 'AIRLINK', name: null }]),
    );

    const summary = await syncAllIndexMembership();

    expect(summary.indices).toBe(3);
    expect(summary.synced.map((s) => s.index)).toEqual(['KMI30', 'KSE100']);
    expect(summary.failed).toEqual([
      { index: 'OGTI', error: 'Source site unavailable: sarmaaya-index-members' },
    ]);
    // Only the two that answered were written.
    expect(mockedReplace).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.marketIndex.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { symbol: 'OGTI' } }),
    );
  });
});
