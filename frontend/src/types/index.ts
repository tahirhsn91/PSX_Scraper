export interface StockListItem {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  currentPrice: number | null;
  changePercent: number | null;
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
    close: number | null; marketCap: number | null; lastTradeDate: string | null;
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
  queues: Record<string, Record<string, number>>;
  inFlight: string[];
}

export type HistoryRange = '1W' | '1M' | '1Y' | '2Y' | '3Y' | '5Y' | 'MAX';

export interface HistoryJobStatus {
  jobId?: string;
  state: 'none' | 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | string;
  progress: { percent?: number; note?: string } | number | null;
  returnValue: { fetched?: number; persisted?: number } | null;
  failedReason: string | null;
}
