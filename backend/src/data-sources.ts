/**
 * The data sources this application reads from.
 *
 * Two jobs, both of which the repo previously left implicit:
 *
 *  1. **Provenance.** Every scraper file maps to exactly one row here, so "where did this number
 *     come from" has an answer a person can look up, and `GET /sync/sources` can show it next to
 *     per-source health.
 *  2. **Operational control.** A source listed in `DATA_SOURCES_DISABLED` is skipped by the pipeline
 *     without a code change — the flag is consulted at scrape time, not at boot.
 *
 * **Licensing.** The status of every source below is `unconfirmed`, deliberately. No written
 * permission, contract or terms review exists in this repository for any provider, and inventing a
 * "permitted" label would be worse than recording the gap. The note on each row says what is
 * missing. Until legal/business supplies a position, the UI must not describe any of this data as
 * licensed, authorised, or real-time.
 */

export type SourceCategory =
  | 'quotes'
  | 'fundamentals'
  | 'candles'
  | 'indices'
  | 'corporate-actions'
  | 'calendar'
  | 'universe'
  | 'reference';

export type LicenceStatus = 'unconfirmed' | 'permitted' | 'restricted' | 'public-data';

export interface DataSource {
  /** Stable id. Also the `source` value written to `source_health` and shown to operators. */
  id: string;
  name: string;
  category: SourceCategory;
  /** What this source is actually used for, in the app's own words. */
  provides: string[];
  hosts: string[];
  /** Scraper files that talk to it. The test asserts every file is claimed exactly once. */
  files: string[];
  licence: {
    status: LicenceStatus;
    notes: string;
  };
  /** Known throttling or behavioural limits, as observed rather than as documented. */
  rateLimit?: string;
}

const UNCONFIRMED = 'No written permission or terms review on record in this repository.';

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'psx',
    name: 'PSX company page',
    category: 'reference',
    provides: ['company name', 'sector', 'ratios', 'financial highlights', 'dividends'],
    hosts: ['dps.psx.com.pk'],
    files: ['psx.scraper.ts'],
    licence: { status: 'unconfirmed', notes: UNCONFIRMED },
    rateLimit: 'Browser-driven; the exchange refuses bursts, which is why Sarmaaya is the fallback.',
  },
  {
    id: 'sarmaaya',
    name: 'Sarmaaya company page',
    category: 'reference',
    provides: ['price block', 'company name', 'sector', 'financial highlights', 'dividends'],
    hosts: ['sarmaaya.pk'],
    files: ['sarmaaya.scraper.ts'],
    licence: { status: 'unconfirmed', notes: UNCONFIRMED },
    rateLimit: 'Browser-driven.',
  },
  {
    id: 'sarmaaya-fundamentals',
    name: 'Sarmaaya fundamentals API',
    category: 'fundamentals',
    provides: ['income statement', 'ratios', 'book value per share', 'dividend history'],
    hosts: ['beta-restapi.sarmaaya.pk'],
    files: ['sarmaayaFundamentals.scraper.ts'],
    licence: { status: 'unconfirmed', notes: `${UNCONFIRMED} Undocumented endpoint, so its terms are unknown even by inspection.` },
  },
  {
    id: 'psx-quotes',
    name: 'PSX DPS quotes',
    category: 'quotes',
    provides: ['intraday quote and traded volume'],
    hosts: ['dps.psx.com.pk'],
    files: ['psxQuotes.scraper.ts', 'sarmaayaQuote.scraper.ts'],
    licence: { status: 'unconfirmed', notes: UNCONFIRMED },
    rateLimit: 'Polled on a cron; see QUOTE_POLL_CRON.',
  },
  {
    id: 'psx-eod',
    name: 'PSX end-of-day candles',
    category: 'candles',
    provides: ['daily OHLC and volume history'],
    hosts: ['dps.psx.com.pk'],
    files: ['historical.scraper.ts'],
    licence: { status: 'unconfirmed', notes: UNCONFIRMED },
  },
  {
    id: 'yahoo-candles',
    name: 'Yahoo Finance',
    category: 'candles',
    provides: ['candle history fallback when the exchange series is short or unavailable'],
    hosts: ['query1.finance.yahoo.com'],
    files: ['yahoo.scraper.ts'],
    licence: { status: 'unconfirmed', notes: `${UNCONFIRMED} Yahoo's terms do not grant redistribution rights for this use.` },
  },
  {
    id: 'psx-indices',
    name: 'PSX indices',
    category: 'indices',
    provides: ['index levels', 'index constituents'],
    hosts: ['sarmaaya.pk', 'beta-restapi.sarmaaya.pk', 'scanner.tradingview.com'],
    files: ['psxIndices.scraper.ts'],
    licence: { status: 'unconfirmed', notes: `${UNCONFIRMED} Reads three different hosts, none with a stated licence.` },
  },
  {
    id: 'psx-holidays',
    name: 'PSX trading calendar',
    category: 'calendar',
    provides: ['market holidays'],
    hosts: ['www.psx.com.pk'],
    files: ['psxHolidays.scraper.ts'],
    licence: { status: 'unconfirmed', notes: UNCONFIRMED },
  },
  {
    id: 'sarmaaya-index-members',
    name: 'Sarmaaya index membership',
    category: 'indices',
    provides: ['index constituent lists'],
    hosts: ['beta-restapi.sarmaaya.pk'],
    files: ['sarmaayaIndexMembers.scraper.ts'],
    licence: { status: 'unconfirmed', notes: UNCONFIRMED },
  },
  {
    id: 'sarmaaya-index-companies',
    name: 'Sarmaaya / Scstrade index companies',
    category: 'universe',
    provides: ['company lists per index', 'symbol discovery'],
    hosts: ['sarmaaya.pk', 'beta-restapi.sarmaaya.pk', 'www.scstrade.com'],
    files: ['sarmaayaIndexCompanies.scraper.ts', 'scstradeKse100.scraper.ts'],
    licence: { status: 'unconfirmed', notes: `${UNCONFIRMED} Scstrade is a broker site, not the exchange.` },
  },
  {
    id: 'tradingview-candles',
    name: 'TradingView scanner',
    category: 'candles',
    provides: ['candle history and market cap inputs'],
    hosts: ['scanner.tradingview.com'],
    files: ['tradingViewCandles.scraper.ts'],
    licence: { status: 'unconfirmed', notes: `${UNCONFIRMED} An unofficial scanner endpoint; its use is not covered by any agreement here.` },
  },
  {
    id: 'sarmaaya-ticker',
    name: 'Sarmaaya ticker',
    category: 'quotes',
    provides: ['symbol-level quote snapshots'],
    hosts: ['beta-restapi.sarmaaya.pk'],
    files: ['sarmaayaTicker.scraper.ts'],
    licence: { status: 'unconfirmed', notes: UNCONFIRMED },
  },
  {
    id: 'universe',
    name: 'Symbol discovery',
    category: 'universe',
    provides: ['the tradable symbol list'],
    hosts: ['sarmaaya.pk', 'github.com'],
    files: ['universe.scraper.ts'],
    licence: { status: 'unconfirmed', notes: UNCONFIRMED },
  },
  {
    id: 'psx-market-cap',
    name: 'Market capitalisation',
    category: 'fundamentals',
    provides: ['market cap, shares outstanding'],
    hosts: ['scanner.tradingview.com', 'stockanalysis.com'],
    files: ['marketCap.scraper.ts'],
    licence: { status: 'unconfirmed', notes: `${UNCONFIRMED} Stockanalysis.com terms are not reviewed.` },
  },
];

export function findSource(id: string): DataSource | undefined {
  return DATA_SOURCES.find((s) => s.id === id);
}

/**
 * Ids switched off for this deployment, from `DATA_SOURCES_DISABLED` (comma-separated).
 *
 * Read on every call rather than cached at import: a container restart is not required to disable a
 * provider that is misbehaving, and it keeps tests able to set the variable per case.
 */
export function disabledSourceIds(): string[] {
  return (process.env.DATA_SOURCES_DISABLED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSourceEnabled(id: string): boolean {
  return !disabledSourceIds().includes(id);
}

/** Guard against a typo silently disabling nothing. */
export function unknownDisabledIds(): string[] {
  return disabledSourceIds().filter((id) => !findSource(id));
}
