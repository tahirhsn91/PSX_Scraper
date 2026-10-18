import { IStockScraper } from '../types/scraper';
import { isSourceEnabled } from '../data-sources';
import { PSXScraper } from './psx.scraper';
import { SarmaayaScraper } from './sarmaaya.scraper';
import { SarmaayaFundamentalsScraper } from './sarmaayaFundamentals.scraper';

/**
 * Pluggable scraper registry. Add a provider by implementing IStockScraper
 * and registering it here — no business-logic changes required (Open/Closed).
 */
class ScraperRegistry {
  private readonly scrapers = new Map<string, IStockScraper>();

  register(scraper: IStockScraper): void {
    this.scrapers.set(scraper.source, scraper);
  }

  /**
   * The scrapers this deployment will actually run.
   *
   * Filtered through the data-source registry so `DATA_SOURCES_DISABLED=psx` takes a provider out of
   * the pipeline with no code change (#214) — the flag is read per call, not at boot.
   */
  enabled(): IStockScraper[] {
    return Array.from(this.scrapers.values()).filter((s) => isSourceEnabled(s.source));
  }

  get(source: string): IStockScraper | undefined {
    return this.scrapers.get(source);
  }
}

export const scraperRegistry = new ScraperRegistry();
scraperRegistry.register(new PSXScraper());
scraperRegistry.register(new SarmaayaScraper());
// The plain-HTTP JSON leg: ratios, book value per share and dividends. Its own provider rather
// than a step inside the page scraper, so a Chromium failure cannot take the ratios with it.
scraperRegistry.register(new SarmaayaFundamentalsScraper());
