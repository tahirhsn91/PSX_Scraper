/**
 * Columns the dashboard can sort by, and the direction. Kept in step with the API's `sort`
 * enum: the server sorts (the table is paginated, so sorting in the browser would only reorder
 * the fifty rows on screen).
 */
export type StockSortField = 'symbol' | 'price' | 'week52Low' | 'week52High' | 'changePercent' | 'volume';

/**
 * One daily candle. `open`/`high`/`low` are null when the source did not report them — the
 * historical EOD feed carries open + close + volume, the live quote carries high/low + close
 * + volume — and the API does not fill the gaps, so the renderer decides how to draw them.
 */
export interface Candle {
  time: string; // exchange session day, YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

/** One index from the exchange's board, as the API serves it. */
export interface IndexSummary {
  symbol: string;
  name: string;
  value: number | null;
  /** Point move against the official previous close — null when nothing has been reported. */
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  lastTradeDate: string | null;
}

export interface CandleSeries {
  symbol: string;
  interval: '1D';
  /** The range preset that produced this window, or null when the caller passed dates. */
  range: string | null;
  count: number;
  /** Readings discarded because they cannot belong to this symbol (contaminated rows). */
  skipped: number;
  /** Readings kept with implausible individual fields nulled. */
  sanitised: number;
  from: string | null;
  to: string | null;
  items: Candle[];
}
export type SortOrder = 'asc' | 'desc';

export interface StockListItem {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  currentPrice: number | null;
  /**
   * Absolute change for the session, in the exchange's own units. Optional: the API sets it only
   * for readings that carried one, so an absent key is "not reported", never a zero.
   */
  change?: number | null;
  changePercent: number | null;
  /** Session volume; null when the source carried none. */
  volume: number | null;
  /** 52-week range (issue #25); null until the company page has been scraped. */
  week52High: number | null;
  week52Low: number | null;
  lastTradeDate: string | null;
  lastSyncedAt: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Which half of the tracked universe a list request is about.
 *
 * `kse100` is the index's published member list and `rest` is every other tracked symbol. Sorting
 * applies within the group, so a grouped page keeps its own membership however the table is
 * ordered. The dashboard scopes its table with `index=<symbol>` instead (any of the 17 indices);
 * `group` remains the way to ask for these two halves specifically.
 */
export type StockListGroup = 'kse100' | 'rest';

/** The stocks list, with both group sizes when a scoped request was made. */
export interface StocksPage extends Paginated<StockListItem> {
  /**
   * Present when `group` or `index` was sent — a filtered list still reports the universe it was
   * drawn from. That is what lets the "Tracked stocks" card count every tracked symbol in any
   * scope without a second request; an unscoped request answers with `total` alone.
   */
  groups?: { kse100: number; rest: number };
}

export interface SearchResult {
  symbol: string;
  companyName: string | null;
  currentPrice: number | null;
  lastSyncedAt: string | null;
  lastTradeDate: string | null;
}

export interface StockDetail {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  price: {
    currentPrice: number | null; change: number | null; changePercent: number | null;
    volume: number | null; high: number | null; low: number | null; open: number | null;
    close: number | null; marketCap: number | null;
    week52High: number | null; week52Low: number | null;
    lastTradeDate: string | null;
  } | null;
  ratios: {
    peRatio: number | null; pbRatio: number | null; roe: number | null;
    roa: number | null; dividendYield: number | null; beta: number | null;
  } | null;
  financials: Array<{
    year: number; quarter: number | null; eps: number | null; sales: number | null;
    profitAfterTax: number | null; assets: number | null; liabilities: number | null; equity: number | null;
  }>;
  dividends: Array<{
    announcementDate: string | null; bookClosure: string | null; paymentDate: string | null; dividend: number | null;
  }>;
  lastSync: { status: string; completedAt: string | null; startedAt: string } | null;
}

export interface PriceRow {
  currentPrice: number | null; open: number | null; high: number | null;
  low: number | null; close: number | null; volume: number | null; lastTradeDate: string | null;
}

export interface SyncLog {
  id: string; symbol: string | null; status: string; startedAt: string;
  completedAt: string | null; durationMs: number | null; errorMessage: string | null;
}

export interface SyncStatus {
  /**
   * Per-queue job counts. `failed` counts failures whose job still exists; `orphans` counts
   * entries in the failed set whose payload is already gone — BullMQ's own counter adds those
   * in, which is how the dashboard came to report a failure that no longer existed.
   */
  queues: Record<string, Record<string, number>>;
  /** Recent failures per queue, newest first. Absent on an older API. */
  failures?: Record<string, QueueFailure[]>;
  inFlight: string[];
}

/**
 * One failed job, as the API reports it. Only failures that still exist are listed here; an
 * entry with no job behind it is counted as an orphan instead, since there is nothing to
 * inspect, retry or act on.
 */
export interface QueueFailure {
  id: string;
  /** Null for jobs that carry no symbol (sync-all, quote-poll). */
  symbol: string | null;
  reason: string;
  /** Failure time in ms since epoch, or null when it was not recorded. */
  failedAt: number | null;
}

/** Presets the dashboard offers. The API also still accepts `2Y`; the UI no longer shows it. */
export type HistoryRange = '1W' | '1M' | '6M' | '1Y' | '3Y' | '5Y' | 'MAX';

export interface HistoryJobStatus {
  jobId?: string;
  state: 'none' | 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | string;
  progress: { percent?: number; note?: string } | number | null;
  returnValue: { fetched?: number; persisted?: number } | null;
  failedReason: string | null;
}
