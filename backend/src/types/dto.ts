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
  /** 52-week range as PSX publishes it; null when the page carries no such block (#25). */
  week52High: number | null;
  week52Low: number | null;
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
  /** Book value per share (equity / shares outstanding) for the newest period the source reports. */
  bookValue: number | null;
  beta: number | null;
  /** Earnings per share, read from the source's own snapshot (`FF_EPS`). Never derived from the
   *  P/E: the source's P/E and its EPS do not divide into one another exactly, so a computed value
   *  would be a different number wearing this row's label. Null = the dash. */
  eps: number | null;
  /** Net profit margin (%), from the source's details payload (`FF_NET_MGN`). */
  netProfitMargin: number | null;
  /** Free-float share count, from the source's details payload (`FF_SHS_FLOAT`). A count, not a %. */
  freeFloatShares: number | null;
  /** Free float as a percentage of shares outstanding (`FF_SHS_FLOAT_PERCENT`). */
  freeFloatPercent: number | null;
  /** Dividend per share — the newest announced per-share dividend from the dividends endpoint. */
  dps: number | null;
  /** Dividend payout ratio, from the ratio series ("Dividend Payout Ratio"). */
  payoutRatio: number | null;
  /** Return on average invested capital (%), from the ratio series. */
  roic: number | null;
  /** Debt to equity (%), from the ratio series ("Debt to Equity (%)"). */
  debtToEquity: number | null;
  /** Current ratio (x), from the ratio series ("Current Ratio (x)"). Banks publish none — null. */
  currentRatio: number | null;
  /** Net sales year-over-year growth (%), from the ratio series ("Net Sales YoY Growth (%)"). */
  revenueGrowth: number | null;
  /** Basic EPS year-over-year growth (%), from the ratio series ("EPS Basic YoY Growth (%)"). */
  epsGrowth: number | null;
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
