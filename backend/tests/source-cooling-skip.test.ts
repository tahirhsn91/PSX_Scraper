import { Job } from 'bullmq';
import { sourceBreaker } from '../src/utils/sourceBreaker';
import { processIndexJob } from '../src/workers/indexProcessor';
import { processHistoryJob } from '../src/workers/historyProcessor';
import { processQuotePollJob } from '../src/workers/quoteProcessor';
import { runIndexSync } from '../src/services/indexSync.service';
import { runHistorySync } from '../src/services/historySync.service';
import { stockRepository } from '../src/repositories/stock.repository';
import { psxQuoteScraper } from '../src/scrapers/psxQuotes.scraper';

/**
 * A source in its cooldown window must make the scheduled jobs *skip*, not fail (#27).
 *
 * The failing behaviour this pins down: on 2026-09-22 the index cron put 200 members in
 * `bull:index-sync:failed` — one per index per tick — for a source that was refusing us, and
 * the history and quote polls did the same. Failing once per symbol per tick is noise about
 * our queue, not information about the data, and it is what made the dashboard's Failed card
 * glow red for an outage we cannot fix by retrying harder.
 */
jest.mock('../src/config', () => ({
  env: {
    QUOTE_POLL_MARKET_HOURS_ONLY: false,
    QUOTE_POLL_CONCURRENCY: 4,
    QUOTE_POLL_TIMEOUT_MS: 1_000,
  },
}));
jest.mock('../src/services/indexSync.service', () => ({ runIndexSync: jest.fn() }));
jest.mock('../src/services/historySync.service', () => ({ runHistorySync: jest.fn() }));
jest.mock('../src/repositories/stock.repository', () => ({
  stockRepository: { findAllSymbols: jest.fn() },
}));
jest.mock('../src/scrapers/psxQuotes.scraper', () => ({
  psxQuoteScraper: { source: 'psx-quotes', fetchMany: jest.fn() },
}));

const runIndexSyncMock = runIndexSync as unknown as jest.Mock;
const runHistorySyncMock = runHistorySync as unknown as jest.Mock;
const findAllSymbols = stockRepository.findAllSymbols as unknown as jest.Mock;
const fetchMany = psxQuoteScraper.fetchMany as unknown as jest.Mock;

const job = <T>(data: T): Job<T> =>
  ({ data, updateProgress: jest.fn().mockResolvedValue(undefined) }) as unknown as Job<T>;

/** Trip the breaker for a source without touching the network. */
const cool = (source: string): void => {
  for (let i = 0; i < 5; i += 1) sourceBreaker.recordFailure(source, 'Source site unavailable');
};

beforeEach(() => {
  sourceBreaker.reset();
  jest.clearAllMocks();
  findAllSymbols.mockResolvedValue(['OGDC']);
});

describe('index-sync while its source is cooling down', () => {
  it('completes the job with a skip instead of a failure', async () => {
    cool('psx-eod');

    const result = await processIndexJob(job({ symbol: 'KSE100', trigger: 'cron' }) as Job<never>);

    expect(result).toMatchObject({ symbol: 'KSE100', skipped: 'source-cooling' });
    expect((result as { resumeAt: string }).resumeAt).toEqual(expect.any(String));
    expect(runIndexSyncMock).not.toHaveBeenCalled();
  });

  it('runs the sync when the source is not cooling down', async () => {
    runIndexSyncMock.mockResolvedValue({ symbol: 'KSE100', status: 'SUCCESS' });

    await processIndexJob(job({ symbol: 'KSE100', trigger: 'cron' }) as Job<never>);

    expect(runIndexSyncMock).toHaveBeenCalledTimes(1);
  });
});

describe('stock-history-sync while its source is cooling down', () => {
  it('completes the job with a skip and no history fetch', async () => {
    cool('psx-eod');

    const result = await processHistoryJob(
      job({ symbol: 'FFC', range: '2Y' }) as Job<never>,
    );

    expect(result).toMatchObject({ symbol: 'FFC', skipped: 'source-cooling' });
    expect(runHistorySyncMock).not.toHaveBeenCalled();
  });
});

describe('the quote poll while its source is cooling down', () => {
  it('does not fan out over the tracked symbols', async () => {
    cool('psx-quotes');

    const summary = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(summary).toMatchObject({ skipped: 'source-cooling', fetched: 0, failed: 0, written: 0 });
    expect(fetchMany).not.toHaveBeenCalled();
  });

  it('still polls when the source is answering', async () => {
    fetchMany.mockResolvedValue({ snapshots: [], failures: [] });

    const summary = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(fetchMany).toHaveBeenCalledTimes(1);
    expect(summary).not.toMatchObject({ skipped: 'source-cooling' });
  });
});
