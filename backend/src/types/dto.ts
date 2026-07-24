/** Canonical, source-agnostic scrape result produced by every scraper. */
export interface PriceDTO {
  currentPrice: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  close: number | null;
  marketCap: number | null;
  lastTradeDate: string | null; // ISO
}

export interface DividendDTO {
  announcementDate: string | null;
  bookClosure: string | null;
  paymentDate: string | null;
  dividend: number | null;
}

export interface FinancialDTO {
  year: number;
  quarter: number | null;
  eps: number | null;
  sales: number | null;
  profitAfterTax: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
}

export interface RatioDTO {
  peRatio: number | null;
  pbRatio: number | null;
  roe: number | null;
  roa: number | null;
  dividendYield: number | null;
  beta: number | null;
}

export interface ScrapeResult {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  price: PriceDTO | null;
  dividends: DividendDTO[];
  financials: FinancialDTO[];
  ratios: RatioDTO | null;
}

export interface ProviderOutcome {
  source: string;
  ok: boolean;
  error?: string;
}
