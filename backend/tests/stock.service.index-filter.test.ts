import { stockService } from '../src/services/stock.service';
import { stockRepository } from '../src/repositories/stock.repository';
import { indexRepository } from '../src/repositories/index.repository';
import { kse100GroupCounts } from '../src/services/kse100Membership.service';
import { ValidationError } from '../src/types/errors';

/**
 * The `index=` filter's contract, at the service the controller actually calls:
 *
 *  - the named index narrows the list and becomes the response's `total`;
 *  - the `groups` block still reports the universe (the dashboard card sums it to 508) whenever
 *    either filter is asked for;
 *  - an index we do not know is a 400 naming it — never a 200 over the whole universe, which is
 *    what made a selector look like it worked while showing the wrong rows.
 */
jest.mock('../src/jobs/queues', () => ({ enqueueSync: jest.fn(), cancelSyncJob: jest.fn() }));
jest.mock('../src/repositories/deletedSymbol.repository', () => ({
  deletedSymbolRepository: { record: jest.fn(), forget: jest.fn(), isDeleted: jest.fn(), all: jest.fn() },
}));
jest.mock('../src/repositories/stock.repository', () => ({
  stockRepository: { list: jest.fn(), findBySymbol: jest.fn(), create: jest.fn(), delete: jest.fn() },
}));
jest.mock('../src/repositories/stockDetail.repository', () => ({
  getStockDetail: jest.fn(),
  getPriceHistory: jest.fn(),
  getCandles: jest.fn(),
}));
jest.mock('../src/repositories/index.repository', () => ({
  indexRepository: { findBySymbol: jest.fn() },
}));
jest.mock('../src/services/kse100Membership.service', () => ({ kse100GroupCounts: jest.fn() }));

const list = stockRepository.list as jest.Mock;
const findBySymbol = indexRepository.findBySymbol as jest.Mock;
const groupCounts = kse100GroupCounts as jest.Mock;

const ITEM = { symbol: 'ABL' };

beforeEach(() => {
  jest.clearAllMocks();
  findBySymbol.mockResolvedValue({ id: 'index-kmi30', symbol: 'KMI30' });
  list.mockResolvedValue({ items: [ITEM], total: 30 });
  groupCounts.mockResolvedValue({ members: 99, rest: 409 });
});

describe('stockService.list with an index filter', () => {
  it('narrows the list to the index and reports the filtered total', async () => {
    const res = await stockService.list(1, 10, undefined, 'asc', undefined, 'KMI30');

    // limit, offset, sort, order, group, index — the index travels to the query, not the group.
    expect(list).toHaveBeenCalledWith(10, 0, undefined, 'asc', undefined, 'KMI30');
    expect(res.total).toBe(30);
    expect(res.totalPages).toBe(3);
    expect(res.items).toEqual([ITEM]);
  });

  it('still carries the universe groups, because the dashboard card sums them to 508', async () => {
    const res = await stockService.list(1, 200, undefined, 'asc', undefined, 'KSE100');

    expect(res.groups).toEqual({ kse100: 99, rest: 409 });
  });

  it('passes the index through even when a group is also given (the index wins)', async () => {
    const res = await stockService.list(1, 50, undefined, 'asc', 'rest', 'KMI30');

    expect(list).toHaveBeenCalledWith(50, 0, undefined, 'asc', 'rest', 'KMI30');
    expect(res.groups).toEqual({ kse100: 99, rest: 409 });
  });

  it('rejects an unknown index with a 400 naming it, and runs no query', async () => {
    findBySymbol.mockResolvedValue(null);

    const error = await stockService.list(1, 10, undefined, 'asc', undefined, 'NOPE').catch((e) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).statusCode).toBe(400);
    expect((error as ValidationError).message).toContain('NOPE');
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps the group path working on its own', async () => {
    const res = await stockService.list(1, 50, undefined, 'asc', 'kse100');

    expect(list).toHaveBeenCalledWith(50, 0, undefined, 'asc', 'kse100', undefined);
    expect(findBySymbol).not.toHaveBeenCalled();
    expect(res.groups).toEqual({ kse100: 99, rest: 409 });
  });

  it('adds no groups block and looks no counts up when neither filter is asked for', async () => {
    list.mockResolvedValue({ items: [ITEM], total: 508 });

    const res = await stockService.list(1, 50);

    expect(list).toHaveBeenCalledWith(50, 0, undefined, 'asc', undefined, undefined);
    expect(res.total).toBe(508);
    expect(res).not.toHaveProperty('groups');
    expect(groupCounts).not.toHaveBeenCalled();
  });
});
