import type { ScrapeResult } from './dto';

/** Common contract every data-provider scraper implements. */
export interface IStockScraper {
  readonly source: string;
  scrape(symbol: string): Promise<ScrapeResult>;
}
