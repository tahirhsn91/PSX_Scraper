import { Job } from 'bullmq';
import { env } from '../src/config';
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
import { fetchSarmaayaQuotes } from '../src/scrapers/sarmaayaQuote.scraper';
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
    // 0 = the DPS fan-out is always due, so a tick in these tests behaves like the first tick of
    // a process. The deferral itself is asserted on its own, where the interval is raised.
    QUOTE_POLL_DPS_MIN_INTERVAL_MS: 0,
    SARMAYA_QUOTE_MAX_SYMBOLS: 60,
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
jest.mock('../src/scrapers/sarmaayaQuote.scraper', () => ({
  SARMAYA_QUOTE_SOURCE: 'sarmaaya-quote',
  fetchSarmaayaQuotes: jest.fn(),
}));

const runIndexSyncMock = runIndexSync as unknown as jest.Mock;
const runHistorySyncMock = runHistorySync as unknown as jest.Mock;
const findAllSymbols = stockRepository.findAllSymbols as unknown as jest.Mock;
const fetchMany = psxQuoteScraper.fetchMany as unknown as jest.Mock;
const tickerMock = fetchSarmaayaTicker as unknown as jest.Mock;
const perSymbolMock = fetchSarmaayaQuotes as unknown as jest.Mock;
const upsertMock = upsertQuoteSnapshot as unknown as jest.Mock;
const mockedEnv = env as unknown as {
  QUOTE_POLL_DPS_MIN_INTERVAL_MS: number;
  SARMAYA_QUOTE_MAX_SYMBOLS: number;
};

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
  mockedEnv.QUOTE_POLL_DPS_MIN_INTERVAL_MS = 0;
  mockedEnv.SARMAYA_QUOTE_MAX_SYMBOLS = 60;
  // Default: the per-symbol leg has nothing to add. Tests that exercise it override this.
  perSymbolMock.mockResolvedValue({ snapshots: [], failures: [] });
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

  it('asks the per-symbol source only for what the ticker list does not carry', async () => {
    // The ticker's list covers the board but not the ETFs, the preference shares and the renamed
    // tickers — measured 2026-09-23 it carried 471–485 rows against 508 tracked symbols, and those
    // symbols kept the browser pass's reading while the rest of the market ticked.
    findAllSymbols.mockResolvedValue(['OGDC', 'ACIETF', 'ENGROH']);
    fetchMany.mockResolvedValue({
      snapshots: [snapshot('OGDC', 318.41, 0.92, 0.29)],
      failures: [],
    });
    tickerMock.mockResolvedValue([]); // neither ACIETF nor ENGROH is in its list
    perSymbolMock.mockResolvedValue({
      snapshots: [snapshot('ACIETF', 16.6, 0.19, 1.16), snapshot('ENGROH', 264.16, 0.36, 0.14)],
      failures: [],
    });

    const summary = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(perSymbolMock).toHaveBeenCalledWith(['ACIETF', 'ENGROH'], { max: 60 });
    expect(summary).toMatchObject({
      source: 'psx-quotes+sarmaaya-quote',
      fetched: 3,
      written: 3,
      failed: 0,
    });
  });

  it('defers the DPS fan-out between its own intervals, and still lands the tick', async () => {
    // A tick a minute against a source that costs one request per symbol is the load that earned
    // the refusal in #27, so the fan-out keeps a slower interval and the ticker serves the board
    // on the ticks in between.
    findAllSymbols.mockResolvedValue(['OGDC']);
    fetchMany.mockResolvedValue({
      snapshots: [snapshot('OGDC', 318.41, 0.92, 0.29)],
      failures: [],
    });
    tickerMock.mockResolvedValue([snapshot('OGDC', 318.6, 1.11, 0.35)]);

    // With no interval to respect (the fixture's default) the fan-out runs.
    const first = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    mockedEnv.QUOTE_POLL_DPS_MIN_INTERVAL_MS = 300_000;
    const second = await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    expect(first).toMatchObject({ source: 'psx-quotes', fetched: 1, written: 1 });
    expect(fetchMany).toHaveBeenCalledTimes(1);
    expect(tickerMock).toHaveBeenCalledWith(['OGDC']);
    expect(second).toMatchObject({ source: 'sarmaaya-ticker', fetched: 1, written: 1, failed: 0 });
  });

  it('walks the per-symbol tail in slices, wrapping so the whole tail is still covered', async () => {
    // Measured 2026-09-23: asking that host for the whole tail every minute (~36 requests a
    // minute) earns `http=429`, which left a third of the tail unrefreshed on every tick.
    mockedEnv.SARMAYA_QUOTE_MAX_SYMBOLS = 2;
    findAllSymbols.mockResolvedValue(['OGDC', 'ACIETF', 'HBLTETF', 'MIIETF']);
    fetchMany.mockResolvedValue({
      snapshots: [snapshot('OGDC', 318.41, 0.92, 0.29)],
      failures: [],
    });
    tickerMock.mockResolvedValue([]); // none of the tail is in its list

    await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);
    await processQuotePollJob(job({ trigger: 'cron' }) as Job<never>);

    const asked = perSymbolMock.mock.calls.map((call) => call[0] as string[]);
    expect(asked.every((slice) => slice.length <= 2)).toBe(true);
    // Two ticks with a slice of two cover all three tail symbols: the walk wraps.
    expect(new Set(asked.flat())).toEqual(new Set(['ACIETF', 'HBLTETF', 'MIIETF']));
  });
});
