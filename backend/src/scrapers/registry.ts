import { IStockScraper } from '../types/scraper';
import { PSXScraper } from './psx.scraper';
import { SarmaayaScraper } from './sarmaaya.scraper';

/**
 * Pluggable scraper registry. Add a provider by implementing IStockScraper
 * and registering it here — no business-logic changes required (Open/Closed).
 */
class ScraperRegistry {
  private readonly scrapers = new Map<string, IStockScraper>();

  register(scraper: IStockScraper): void {
    this.scrapers.set(scraper.source, scraper);
  }

  enabled(): IStockScraper[] {
    return Array.from(this.scrapers.values());
  }

  get(source: string): IStockScraper | undefined {
    return this.scrapers.get(source);
  }
}

export const scraperRegistry = new ScraperRegistry();
scraperRegistry.register(new PSXScraper());
scraperRegistry.register(new SarmaayaScraper());
