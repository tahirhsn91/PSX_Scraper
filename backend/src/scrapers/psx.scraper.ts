import { Page } from 'puppeteer';
import { browserPool } from './browserPool';
import { toNumber, toIsoDate } from './parse.utils';
import { logger } from '../utils/logger';
import {
  IStockScraper,
} from '../types/scraper';
import { ScrapeResult } from '../types/dto';
import { InvalidSymbolError, NavigationTimeoutError, SiteUnavailableError } from '../types/errors';

/**
 * Scraper for https://dps.psx.com.pk/company/{SYMBOL}
 * Selectors are centralized so markup drift is a config change, not a code change.
 */
export class PSXScraper implements IStockScraper {
  readonly source = 'psx';

  private readonly baseUrl = 'https://dps.psx.com.pk/company';

  async scrape(symbol: string): Promise<ScrapeResult> {
    const sym = symbol.toUpperCase();
    return browserPool.withPage(async (page) => this.run(page, sym));
  }

  private async run(page: Page, symbol: string): Promise<ScrapeResult> {
    const url = `${this.baseUrl}/${symbol}`;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (resp && resp.status() === 404) throw new InvalidSymbolError(symbol);
      if (resp && resp.status() >= 500) throw new SiteUnavailableError(this.source);
    } catch (err) {
      if (err instanceof InvalidSymbolError || err instanceof SiteUnavailableError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('timeout')) throw new NavigationTimeoutError(this.source, { url });
      throw new SiteUnavailableError(this.source, { message: msg });
    }

    // Extract with resilient selectors; missing fields => null (never fabricated).
    const data = await page.evaluate(() => {
      const text = (sel: string): string | null => document.querySelector(sel)?.textContent?.trim() ?? null;
      const attrText = (label: string): string | null => {
        const nodes = Array.from(document.querySelectorAll('.stats_item, .quote__item, .company__title, td, div'));
        const hit = nodes.find((n) => n.textContent?.toLowerCase().includes(label.toLowerCase()));
        return hit?.textContent?.trim() ?? null;
      };
      return {
        company: text('.quote__name') ?? text('h1') ?? text('.company__title'),
        sector: text('.quote__sector') ?? attrText('sector'),
        price: text('.quote__close') ?? text('[data-field="price"]'),
        change: text('.quote__change'),
        changePercent: text('.quote__change_percent') ?? text('.change__percent'),
        volume: attrText('volume'),
        high: attrText('high'),
        low: attrText('low'),
        open: attrText('open'),
        marketCap: attrText('market cap'),
      };
    });

    const result: ScrapeResult = {
      symbol,
      companyName: data.company,
      sector: data.sector,
      price: {
        currentPrice: toNumber(data.price),
        change: toNumber(data.change),
        changePercent: toNumber(data.changePercent),
        volume: toNumber(data.volume),
        high: toNumber(data.high),
        low: toNumber(data.low),
        open: toNumber(data.open),
        close: toNumber(data.price),
        marketCap: toNumber(data.marketCap),
        lastTradeDate: toIsoDate(new Date().toISOString()),
      },
      dividends: [],
      financials: [],
      ratios: null,
    };
    logger.debug('psx.scraped', { symbol, hasCompany: !!result.companyName });
    return result;
  }
}
