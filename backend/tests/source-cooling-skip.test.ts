import { Job } from 'bullmq';
import { sourceBreaker } from '../src/utils/sourceBreaker';
import { processIndexJob } from '../src/workers/indexProcessor';
import { processHistoryJob } from '../src/workers/historyProcessor';
import { processQuotePollJob } from '../src/workers/quoteProcessor';
import { runIndexSync } from '../src/services/indexSync.service';
import { runHistorySync } from '../src/services/historySync.service';
import { stockRepository } from '../src/repositories/stock.repository';
import { upsertQuoteSnapshot } from '../src/repositories/stockPrice.repository';
import { psxQuoteScraper } from '../src/scrapers/psxQuotes.scraper';
import { fetchSarmaayaTicker } from '../src/scrapers/sarmaayaTicker.scraper';
import type { QuoteSnapshot } from '../src/scrapers/psxQuotes.scraper';

/**
 * A source in its cooldown window must make the scheduled jobs *skip*, not fail (#27).
 *
 * The failing behaviour this pins down: on 2026-09-22 the index cron put 200 members in
 * `bull:index-sync:failed` — one per index per tick — for a source that was refusing us, and
 * the history and quote polls did the same. Failing once per symbol per tick is noise about
 * our queue, not information about the data, and it is what made the dashboard's Failed card
 * glow red for an outage we cannot fix by retrying harder.
 *
 * The quote poll is the one case where the skip is not the end of the story: a skipped tick
 * used to mean every symbol kept the last full sync's price, so a day the market moved was
 * published as a day it did not. It now lands the tick from the market-wide fallback instead.
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
jest.mock('../src/repositories/stockPrice.repository', () => ({
  upsertQuoteSnapshot: jest.fn(),
}));
jest.mock('../src/scrapers/psxQuotes.scraper', () => ({
  psxQuoteScraper: { source: 'psx-quotes', fetchMany: jest.fn() },
}));
jest.mock('../src/scrapers/sarmaayaTicker.scraper', () => ({
  SARMAYA_TICKER_SOURCE: 'sarmaaya-ticker',
  fetchSarmaayaTicker: jest.fn(),
}));

const runIndexSyncMock = runIndexSync as unknown as jest.Mock;
const runHistorySyncMock = runHistorySync as unknown as jest.Mock;
const findAllSymbols = stockRepository.findAllSymbols as unknown as jest.Mock;
const fetchMany = psxQuoteScraper.fetchMany as unknown as jest.Mock;
const tickerMock = fetchSarmaayaTicker as unknown as jest.Mock;
const upsertMock = upsertQuoteSnapshot as unknown as jest.Mock;

const job = <T>(data: T): Job<T> =>
  ({ data, updateProgress: jest.fn().mockResolvedValue(undefined) }) as unknown as Job<T>;

/** Trip the breaker for a source without touching the network. */
const cool = (source: string): void => {
  for (let i = 0; i < 5; i += 1) sourceBreaker.recordFailure(source, 'Source site unavailable');
};

const snapshot = (symbol: string, price: number, change: number, changePercent: number): QuoteSnapshot => ({
  symbol,
  sessionDate: new Date('2026-09-22T11:00:00.000Z'),
  price,
  open: null,
  volume: 331_758,
  previousClose: null,
  change,
  changePercent,
});

beforeEach(() => {
  sourceBreaker.reset();
  jest.clearAllMocks();
  findAllSymbols.mockResolvedValue(['OGDC']);
  upsertMock.mockResolvedValue(true);
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

describe('the quote poll while its primary source is cooling down', () => {
  it('lands the tick from the market-wide fallback instead of skipping it', async () => {
    cool('psx-quotes');
    tickerMock.mockResolvedValue([snapshot('OGDC', 318.41, 0.92, 0.29)]);

    const summary = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(summary).toMatchObject({ source: 'sarmaaya-ticker', fetched: 1, written: 1, failed: 0 });
    expect(summary.skipped).toBeUndefined();
    expect(fetchMany).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it('reports a skip when neither source answers', async () => {
    cool('psx-quotes');
    tickerMock.mockRejectedValue(new Error('Source site unavailable: sarmaaya-ticker'));

    const summary = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(summary).toMatchObject({ skipped: 'no-source', fetched: 0, written: 0 });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe('the quote poll while its primary source is answering', () => {
  it('uses the primary alone when it covers every tracked symbol', async () => {
    fetchMany.mockResolvedValue({ snapshots: [snapshot('OGDC', 318.41, 0.92, 0.29)], failures: [] });

    const summary = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(summary).toMatchObject({ source: 'psx-quotes', fetched: 1, written: 1, failed: 0 });
    expect(tickerMock).not.toHaveBeenCalled();
  });

  it('fills only the symbols the primary could not serve', async () => {
    // The shape of the #27 outage: the series answers some requests and drops others, so a
    // tick where 100 of 509 symbols came back is normal — the rest must not be left on the
    // last full sync's price.
    findAllSymbols.mockResolvedValue(['OGDC', 'FFC', 'ABL']);
    fetchMany.mockResolvedValue({
      snapshots: [snapshot('OGDC', 318.41, 0.92, 0.29)],
      failures: [
        { symbol: 'FFC', error: 'Empty reply from server' },
        { symbol: 'ABL', error: 'Empty reply from server' },
      ],
    });
    tickerMock.mockResolvedValue([
      snapshot('FFC', 538.2, -0.65, -0.12),
      snapshot('ABL', 170.05, -0.43, -0.25),
    ]);

    const summary = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(tickerMock).toHaveBeenCalledWith(['FFC', 'ABL']);
    expect(summary).toMatchObject({
      source: 'psx-quotes+sarmaaya-ticker',
      fetched: 3,
      written: 3,
      failed: 0,
    });
  });

  it('counts a symbol no source could refresh as failed', async () => {
    findAllSymbols.mockResolvedValue(['OGDC', 'FFC']);
    fetchMany.mockResolvedValue({
      snapshots: [snapshot('OGDC', 318.41, 0.92, 0.29)],
      failures: [{ symbol: 'FFC', error: 'series carried no usable row' }],
    });
    tickerMock.mockResolvedValue([]);

    const summary = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(summary).toMatchObject({ source: 'psx-quotes', fetched: 1, written: 1, failed: 1 });
  });
});
