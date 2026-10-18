/**
 * Columns the dashboard can sort by, and the direction. Kept in step with the API's `sort`
 * enum: the server sorts (the table is paginated, so sorting in the browser would only reorder
 * the fifty rows on screen).
 */
export type StockSortField = 'symbol' | 'price' | 'week52Low' | 'week52High' | 'change' | 'changePercent' | 'volume' | 'marketCap' | 'points' | 'weight' | 'dividendYield' | 'peRatio' | 'pbRatio' | 'roe' | 'beta' | 'return';

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
  /**
   * The exchange's own published index volume. Nothing has been published to us since 2026-09-22
   * (the source is refused at the edge and the reachable one carries no volume), so this is null.
   */
  volume: number | null;
  /**
   * Sum of the index's constituents' volumes for the newest session, present only where that sum was
   * proved to equal PSX's published figure on the last day both existed (12 of the 17 indices). A
   * derived figure, which is why it is a separate key from `volume`.
   */
  constituentVolume?: number | null;
  /** 52-week high/low and market cap from Sarmaaya's board — for the SEO meta description. */
  week52High?: number | null;
  week52Low?: number | null;
  marketCap?: number | null;
  /** 1-year and year-to-date percentage returns; null when the stored series is too short. */
  return1y?: number | null;
  returnYtd?: number | null;
  lastTradeDate: string | null;
  /**
   * When the newest reading behind this index was stored — effectively when the board last read it.
   * Distinct from `lastTradeDate`, which is the session the value belongs to: a board that has
   * stopped reading keeps serving its last session, so the two are only alike while the board is
   * alive. Null when we hold no reading for the index.
   */
  liveAt?: string | null;
}

export interface CandleSeries {
  symbol: string;
  interval: '1D';
  /** Which price basis the series is in. */
  basis: 'as-traded' | 'adjusted';
  /** Corporate actions on record for this symbol; 0 means adjustment is a no-op. */
  actions: number;
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
  /** Price return over the requested period, dividends excluded. Null = not enough history. */
  periodReturn?: number | null;
  /** Sessions of history behind that return, capped at the period's session count + 1. */
  returnSessions?: number | null;
  /** Present only when the row came from a named screen: why this row is on the list. */
  reason?: string;
  /** Technical columns, present when the screen asked for them (`technical=1`). */
  rsi?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  maRelation?: 'above_sma50' | 'below_sma50' | null;
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  /** Company logo URL for the SYMBOL column icon; null when no source published one (letter avatar then). */
  logoUrl: string | null;
  currentPrice: number | null;
  /**
   * Absolute change for the session, in the exchange's own units. Optional: the API sets it only
   * for readings that carried one, so an absent key is "not reported", never a zero.
   */
  change?: number | null;
  changePercent: number | null;
  /** Session volume; null when the source carried none. */
  volume: number | null;
  /** Market capitalisation in rupees; absent when no reachable source published one (#71). */
  marketCap?: number | null;
  /** 52-week range (issue #25); null until the company page has been scraped. */
  week52High: number | null;
  week52Low: number | null;
  /**
   * Index points this stock contributed, signed, re-read every couple of minutes through the session.
   * Absent when the stock is in neither index we read contributions for — a symbol the index does not
   * carry has no contribution, and `0.00` would claim it moved the index by nothing.
   */
  points?: number | null;
  /**
   * Which index `points` is measured against — `KSE100` where the stock is a member, `ALLSHR`
   * otherwise. Always shown beside the figure, because the two are different scales.
   */
  pointsIndex?: string;
  /**
   * The stock's share of that same index, in percent — `8.94` is 8.94% of the index — re-read on the
   * same cadence as `points` and shown beside it. Absent for exactly the symbols `points` is absent
   * for, because it comes off the same stored reading rather than a second source.
   */
  weight?: number | null;
  lastTradeDate: string | null;
  lastSyncedAt: string | null;
  /** Ratio fields, present when the list query joins the newest ratio row (the screener shows
   *  them; the plain board ignores them). Null when the source published none — never a zero. */
  peRatio?: number | null;
  pbRatio?: number | null;
  dividendYield?: number | null;
  roe?: number | null;
  beta?: number | null;
  debtToEquity?: number | null;
  eps?: number | null;
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
/**
 * A named screen as the server defines it. The label and the one-line description are shown next to
 * the results, so the reader can see the rule that produced them.
 */
export interface ScreenerPreset {
  key: string;
  label: string;
  description: string;
  caveat?: string;
}

export interface StocksPage extends Paginated<StockListItem> {
  /** Echoed by the server when `preset` was requested, including any limitation worth printing. */
  preset?: ScreenerPreset;
  /**
   * Present when `group` or `index` was sent — a filtered list still reports the universe it was
   * drawn from. That is what lets the "Tracked stocks" card count every tracked symbol in any
   * scope without a second request; an unscoped request answers with `total` alone.
   */
  groups?: { kse100: number; rest: number };
  /**
   * Present when technical data was computed for this page: the window its indicators were judged
   * over, and how many stocks were left out for lack of history. Stated so a filter cannot look
   * like it covered the whole board when it did not.
   */
  technical?: {
    windowStart: string | null;
    windowEnd: string | null;
    minimumSessions: number;
    excluded: number;
  };
}

export interface SearchResult {
  symbol: string;
  companyName: string | null;
  currentPrice: number | null;
  lastSyncedAt: string | null;
  /** Served by the API but previously untyped and unrendered. */
  sector?: string | null;
  lastTradeDate: string | null;
}

/**
 * A product a company makes, with its image and that image's provenance (#180).
 *
 * `imagePath` is a root-relative path this app serves, never a remote URL, and the API withholds it
 * unless `imageSource` and `imageLicence` are both recorded — an image whose provenance cannot be
 * stated is not published.
 */
export interface CompanyProduct {
  name: string;
  summary: string | null;
  imagePath: string | null;
  imageSource: string | null;
  imageLicence: string | null;
}

/**
 * The stock page's Company Description section (#180).
 *
 * Editorial content, written by hand — no source this project integrates publishes a description,
 * CEO, website, phone or product list. Null for almost every symbol while the content is written
 * up in batches, which is why every field is nullable and the section renders nothing at all when
 * there is no profile.
 */
export interface CompanyProfile {
  description: string | null;
  headOffice: string | null;
  phone: string | null;
  website: string | null;
  ceo: string | null;
  /** Where the content came from, shown to the reader so they can weigh it. */
  sourceNote: string | null;
  updatedAt: string;
  products: CompanyProduct[];
}

/** `profile: null` means the stock is tracked but nobody has written it up — not an error. */
export interface StockProfileResponse {
  symbol: string;
  profile: CompanyProfile | null;
}

export interface StockDetail {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  /**
   * Symbols of the tracked indices this stock is a constituent of (#174), read live from the
   * membership table so an index rebalance is reflected immediately. Empty when it belongs to none
   * of them — the page then shows no index links rather than guessing one.
   */
  indices: string[];
  price: {
    currentPrice: number | null;
    change: number | null;
    changePercent: number | null;
    volume: number | null;
    high: number | null;
    low: number | null;
    open: number | null;
    close: number | null;
    marketCap: number | null;
    week52High: number | null;
    week52Low: number | null;
    lastTradeDate: string | null;
  } | null;
  ratios: {
    peRatio: number | null;
    pbRatio: number | null;
    roe: number | null;
    roa: number | null;
    dividendYield: number | null;
    beta: number | null;
    bookValue: number | null;
    eps: number | null;
    netProfitMargin: number | null;
    freeFloatShares: number | null;
    freeFloatPercent: number | null;
    dps: number | null;
    payoutRatio: number | null;
    roic: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    revenueGrowth: number | null;
    epsGrowth: number | null;
  } | null;
  /** Fundamentals scoring (#131): null when there are no ratios or the sector is missing. */
  insights: {
    overall: number | null;
    verdict: 'strong' | 'fair' | 'weak' | null;
    current: { score: number | null; assessed: number };
    future: { score: number | null; assessed: number; fallback: boolean };
    outlook: 'positive' | 'neutral' | 'cautious' | null;
  } | null;
  financials: Array<{
    year: number;
    quarter: number | null;
    eps: number | null;
    sales: number | null;
    profitAfterTax: number | null;
    assets: number | null;
    liabilities: number | null;
    equity: number | null;
  }>;
  /** The full income statement: ordered columns ("TTM" first, then fiscal years newest-first) and
   *  ordered line items. Null for a stock the source publishes nothing for (ETFs, funds). */
  incomeStatement: {
    periods: string[];
    lines: Array<{
      metricCode: string;
      metricName: string;
      values: Record<string, number | null>;
    }>;
  } | null;
  dividends: Array<{
    announcementDate: string | null;
    bookClosure: string | null;
    paymentDate: string | null;
    dividend: number | null;
  }>;
  lastSync: {
    status: string;
    completedAt: string | null;
    startedAt: string;
  } | null;
}

export interface PriceRow {
  currentPrice: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  lastTradeDate: string | null;
}

export interface SyncLog {
  id: string;
  symbol: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
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
export type HistoryRange = "1W" | "1M" | "6M" | "1Y" | "3Y" | "5Y" | "MAX";

export interface HistoryJobStatus {
  jobId?: string;
  state:
    | "none"
    | "waiting"
    | "active"
    | "delayed"
    | "completed"
    | "failed"
    | string;
  progress: { percent?: number; note?: string } | number | null;
  returnValue: { fetched?: number; persisted?: number } | null;
  failedReason: string | null;
}

/** Screener criteria, mirroring the API's optional filter fields. Absent means "no criterion". */
export interface StockFilters {
  sector?: string;
  minPrice?: number;
  maxPrice?: number;
  minMarketCap?: number;
  maxMarketCap?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minPe?: number;
  maxPe?: number;
  minPb?: number;
  maxPb?: number;
  minDividendYield?: number;
  minRoe?: number;
  maxDebtToEquity?: number;
  /** Window for the period-return filter and column (sessions, not calendar days). */
  returnPeriod?: '1w' | '1m' | '3m' | '6m' | '1y';
  /** Minimum / maximum price return over that window, in percent. */
  minReturn?: number;
  maxReturn?: number;
  /** Wilder RSI(14) bounds, computed server-side by the indicator engine. */
  minRsi?: number;
  maxRsi?: number;
  /** Close versus a simple moving average on the latest session. */
  maRelation?: 'above_sma50' | 'below_sma50' | 'above_sma200' | 'below_sma200';
  /** Ask for the technical columns without filtering on them. */
  technical?: boolean;
  /** A watchlist: "give me these specific symbols". Sent as a comma-joined string. */
  symbols?: string[];
}

export interface MarketBreadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  totalVolume: number | null;
  newHighs: number;
  newLows: number;
}

export interface Mover {
  symbol: string;
  companyName: string | null;
  currentPrice: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
}

export interface MarketOverview {
  breadth: MarketBreadth;
  movers: { gainers: Mover[]; losers: Mover[]; mostActive: Mover[] };
}

export interface IndicatorPoint {
  date: string;
  value: number | null;
}

/** One indicator as the API returns it, with the parameters and window it was computed over. */
export interface IndicatorSeries {
  name: string;
  params: Record<string, number>;
  windowStart: string | null;
  windowEnd: string | null;
  unadjusted: true;
  insufficientData: boolean;
  requiredSessions: number;
  availableSessions: number;
  points: IndicatorPoint[];
}

export interface IndicatorsResponse {
  symbol: string;
  range: string;
  sessions: number;
  from: string | null;
  to: string | null;
  skipped: number;
  sanitised: number;
  series: IndicatorSeries[];
}

export interface CompareSeries {
  symbol: string;
  name: string | null;
  points: { date: string; value: number }[];
  returnPct: number;
  volatilityPct: number;
  maxDrawdownPct: number;
  sessions: number;
}

/** Two to five symbols over one shared window, each rebased to 100 at the first common date. */
export interface CompareResponse {
  period: '1m' | '3m' | '6m' | '1y' | '3y';
  windowStart: string | null;
  windowEnd: string | null;
  series: CompareSeries[];
  excluded: { symbol: string; reason: string }[];
  /** Symbols whose shorter history set the shared window. */
  shortenedBy: { symbol: string; sessions: number }[];
}

export interface PeriodReturn {
  period: '1w' | '1m' | '3m' | '6m' | '1y';
  sessions: number;
  available: number | null;
  value: number | null;
}

/** One symbol's returns and its rebased comparison with an index. */
export interface PerformanceResponse {
  symbol: string;
  returns: PeriodReturn[];
  benchmark: {
    index: { symbol: string; name: string };
    base: 100;
    baseDate: string | null;
    points: { date: string; stock: number; index: number }[];
    carried: boolean;
  } | null;
}

export interface SectorConstituent {
  symbol: string;
  companyName: string | null;
  currentPrice: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;
}

/** One sector's drill-down: aggregate, members, and where the classification came from. */
export interface SectorDetail {
  sector: string;
  count: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  avgChangePercent: number | null;
  totalMarketCap: number | null;
  totalVolume: number | null;
  /** Provider that supplied the sector label; null when it was never recorded. */
  source: string | null;
  /** When the label was last read; null means "not recorded yet", not "today". */
  updatedAt: string | null;
  gainers: SectorConstituent[];
  losers: SectorConstituent[];
  constituents: SectorConstituent[];
}

export interface SectorSummary {
  sector: string;
  count: number;
  avgChangePercent: number | null;
  totalMarketCap: number | null;
  advancers: number;
  decliners: number;
}

export interface DividendEvent {
  symbol: string;
  companyName: string | null;
  announcementDate: string | null;
  bookClosure: string | null;
  paymentDate: string | null;
  dividend: number | null;
}

export interface YieldRow {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  dividendYield: number | null;
  currentPrice: number | null;
}

export interface DividendData {
  upcoming: DividendEvent[];
  topYield: YieldRow[];
}

/** How current a dataset is — the words the API is willing to stand behind. */
export type DatasetStatus = 'live' | 'delayed' | 'end-of-day' | 'stale' | 'unavailable';

export interface DatasetFreshness {
  /** ISO instant of the newest stored reading, or null when nothing is stored. */
  asOf: string | null;
  status: DatasetStatus;
  source: string;
  ageSeconds: number | null;
}

export type SessionLabel = 'open' | 'pre-open' | 'post-close' | 'weekend' | 'holiday';

/**
 * Session state and per-dataset freshness from `GET /market/status`. One payload for the whole
 * app, so that the dashboard, a stock page and the dividends table cannot disagree about whether
 * the market is open or how old the numbers are.
 */
export interface MarketStatus {
  now: string;
  marketDate: string;
  lastSessionDate: string | null;
  session: 'open' | 'closed';
  sessionLabel: SessionLabel;
  datasets: {
    quotes: DatasetFreshness;
    indices: DatasetFreshness;
    candles: DatasetFreshness;
    dividends: DatasetFreshness;
  };
}

export type MoverType = 'gainers' | 'losers' | 'active' | 'unusual';
export type MoverPeriod = '1d' | '1w' | '1m';

export interface Mover {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Return over the selected period. 1d uses the exchange's published change%. */
  periodReturnPercent: number | null;
  volume: number | null;
  avgVolume20: number | null;
  relativeVolume: number | null;
  reason: string;
}

export interface MoversPayload {
  type: MoverType;
  period: MoverPeriod;
  sessionDate: string | null;
  rows: Mover[];
  meta: {
    ranked: number;
    excludedIlliquid: number;
    liquidityFloorShares: number;
    relativeVolumeFormula: string;
    tradedValueNote: string;
  };
}
