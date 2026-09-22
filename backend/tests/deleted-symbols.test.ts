import { stockService } from '../src/services/stock.service';
import { stockRepository } from '../src/repositories/stock.repository';
import { deletedSymbolRepository } from '../src/repositories/deletedSymbol.repository';
import { cancelSyncJob, enqueueSync } from '../src/jobs/queues';
import { runOneSync } from '../src/services/syncRunner.service';
import { runUniverseSymbol } from '../src/services/universeRunner.service';
import { processSyncJob } from '../src/workers/syncProcessor';
import { processUniverseJob } from '../src/workers/universeProcessor';

jest.mock('../src/jobs/queues', () => ({
  enqueueSync: jest.fn(),
  cancelSyncJob: jest.fn(),
}));
jest.mock('../src/repositories/stock.repository', () => ({
  stockRepository: { findBySymbol: jest.fn(), delete: jest.fn(), create: jest.fn(), list: jest.fn() },
}));
jest.mock('../src/repositories/deletedSymbol.repository', () => ({
  deletedSymbolRepository: { record: jest.fn(), forget: jest.fn(), isDeleted: jest.fn(), all: jest.fn() },
}));
jest.mock('../src/repositories/stockDetail.repository', () => ({
  getStockDetail: jest.fn(),
  getPriceHistory: jest.fn(),
}));
jest.mock('../src/services/syncRunner.service', () => ({ runOneSync: jest.fn() }));
jest.mock('../src/services/universeRunner.service', () => ({ runUniverseSymbol: jest.fn(), startUniversePass: jest.fn() }));

const findBySymbol = stockRepository.findBySymbol as jest.Mock;
const removeRow = stockRepository.delete as jest.Mock;
const createRow = stockRepository.create as jest.Mock;
const record = deletedSymbolRepository.record as jest.Mock;
const forget = deletedSymbolRepository.forget as jest.Mock;
const isDeleted = deletedSymbolRepository.isDeleted as jest.Mock;
const cancel = cancelSyncJob as jest.Mock;
const enqueue = enqueueSync as jest.Mock;
const syncOne = runOneSync as jest.Mock;
const walkSymbol = runUniverseSymbol as jest.Mock;

describe('removal is remembered', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records the tombstone only after the row is actually gone', async () => {
    findBySymbol.mockResolvedValue({ id: 's1', symbol: 'ENGRO' });
    cancel.mockResolvedValue('waiting');
    removeRow.mockResolvedValue(undefined);
    record.mockResolvedValue(undefined);

    await stockService.remove('ENGRO', 'no such stock in PSX; stale listing page');

    expect(removeRow).toHaveBeenCalledWith('ENGRO');
    expect(record).toHaveBeenCalledWith('ENGRO', 'no such stock in PSX; stale listing page');
    // Order is the point: recording first would deny a symbol that is still tracked if the delete
    // then failed.
    expect(removeRow.mock.invocationCallOrder[0]!).toBeLessThan(record.mock.invocationCallOrder[0]!);
  });

  it('records nothing when the delete fails', async () => {
    findBySymbol.mockResolvedValue({ id: 's1', symbol: 'ENGRO' });
    cancel.mockResolvedValue('waiting');
    removeRow.mockRejectedValue(new Error('database is down'));

    await expect(stockService.remove('ENGRO')).rejects.toThrow('database is down');
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses a plain add of a removed symbol, so an automated client cannot undo the deletion', async () => {
    // The live shape of this: PSX_Portfolio_Manager answers its own 404 with `POST /api/v1/stocks`,
    // which put a delisted symbol back on the dashboard every time its page was opened.
    findBySymbol.mockResolvedValue(null);
    isDeleted.mockResolvedValue(true);

    await expect(stockService.add('ENGRO')).rejects.toThrow(/removed/i);

    expect(createRow).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it('an explicit forced add forgets the removal', async () => {
    findBySymbol.mockResolvedValue(null);
    isDeleted.mockResolvedValue(true);
    createRow.mockResolvedValue({ id: 's2', symbol: 'ENGRO' });
    enqueue.mockResolvedValue({ id: 'job1' });
    forget.mockResolvedValue(undefined);

    await stockService.add('ENGRO', { force: true });

    expect(createRow).toHaveBeenCalledWith('ENGRO');
    expect(forget).toHaveBeenCalledWith('ENGRO');
  });

  it('a symbol that was never removed needs no force', async () => {
    findBySymbol.mockResolvedValue(null);
    isDeleted.mockResolvedValue(false);
    createRow.mockResolvedValue({ id: 's3', symbol: 'FFC' });
    enqueue.mockResolvedValue({ id: 'job2' });

    await stockService.add('FFC');

    expect(createRow).toHaveBeenCalledWith('FFC');
  });
});

describe('no registration path can put a removed symbol back', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the sync processor skips it without touching the scraper', async () => {
    isDeleted.mockResolvedValue(true);
    const out = await processSyncJob({ data: { symbol: 'ENGRO', trigger: 'cron' } } as never);
    expect(syncOne).not.toHaveBeenCalled();
    expect(out).toEqual({ skipped: true, reason: 'symbol was removed from Scrapper' });
  });

  it('the sync processor still runs a normal symbol', async () => {
    isDeleted.mockResolvedValue(false);
    syncOne.mockResolvedValue({ ok: true });
    const out = await processSyncJob({ data: { symbol: 'FFC', trigger: 'cron' } } as never);
    expect(syncOne).toHaveBeenCalledWith('FFC', expect.any(Function));
    expect(out).toEqual({ ok: true });
  });

  it('the universe pass skips it without scraping the listing page', async () => {
    isDeleted.mockResolvedValue(true);
    const out = await processUniverseJob({ id: 'u1', name: 'universe-symbol', data: { symbol: 'ENGRO' } } as never);
    expect(walkSymbol).not.toHaveBeenCalled();
    expect(out).toEqual({ skipped: true, reason: 'symbol was removed from Scrapper' });
  });
});
