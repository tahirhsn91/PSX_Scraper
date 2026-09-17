import { stockService } from '../src/services/stock.service';
import { stockRepository } from '../src/repositories/stock.repository';
import { cancelSyncJob } from '../src/jobs/queues';
import { NotFoundError } from '../src/types/errors';

jest.mock('../src/jobs/queues', () => ({
  enqueueSync: jest.fn(),
  cancelSyncJob: jest.fn(),
}));
jest.mock('../src/repositories/stock.repository', () => ({
  stockRepository: {
    findBySymbol: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
    list: jest.fn(),
  },
}));
jest.mock('../src/repositories/stockDetail.repository', () => ({
  getStockDetail: jest.fn(),
  getPriceHistory: jest.fn(),
}));

const findBySymbol = stockRepository.findBySymbol as jest.Mock;
const removeRow = stockRepository.delete as jest.Mock;
const cancel = cancelSyncJob as jest.Mock;

describe('stockService.remove', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancels the symbol\'s queued sync BEFORE deleting the row', async () => {
    // The scraper persists through stock.upsert, so a job left in the queue re-creates the
    // stock that was just deleted. Cancel first, delete second — order is the whole fix.
    findBySymbol.mockResolvedValue({ id: 's1', symbol: 'ENGRO' });
    cancel.mockResolvedValue('waiting');
    removeRow.mockResolvedValue(undefined);

    await stockService.remove('engro');

    expect(cancel).toHaveBeenCalledWith('ENGRO');
    expect(removeRow).toHaveBeenCalledWith('engro');
    expect(cancel.mock.invocationCallOrder[0]!).toBeLessThan(removeRow.mock.invocationCallOrder[0]!);
  });

  it('still deletes when a sync is already running, since a running job cannot be removed', async () => {
    findBySymbol.mockResolvedValue({ id: 's2', symbol: 'FFC' });
    cancel.mockResolvedValue('active');
    removeRow.mockResolvedValue(undefined);

    await stockService.remove('FFC');

    expect(removeRow).toHaveBeenCalledWith('FFC');
  });

  it('rejects an untracked symbol without touching the queue or the table', async () => {
    findBySymbol.mockResolvedValue(null);

    await expect(stockService.remove('NOPE')).rejects.toBeInstanceOf(NotFoundError);

    expect(cancel).not.toHaveBeenCalled();
    expect(removeRow).not.toHaveBeenCalled();
  });
});
