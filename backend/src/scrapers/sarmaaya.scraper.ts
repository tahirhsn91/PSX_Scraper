import { Page } from 'puppeteer';
import { browserPool } from './browserPool';
import { toNumber, toIsoDate } from './parse.utils';
import { logger } from '../utils/logger';
import { IStockScraper } from '../types/scraper';
import { ScrapeResult, FinancialDTO, DividendDTO } from '../types/dto';
import { InvalidSymbolError, NavigationTimeoutError, SiteUnavailableError } from '../types/errors';

/**
 * Scraper for https://sarmaaya.pk/stocks/{SYMBOL}
 * Provides richer ratios / financials / dividends than the PSX DPS page.
 */
export class SarmaayaScraper implements IStockScraper {
  readonly source = 'sarmaaya';

  private readonly baseUrl = 'https://sarmaaya.pk/stocks';

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

    const data = await page.evaluate(() => {
      const byLabel = (label: string): string | null => {
        const nodes = Array.from(document.querySelectorAll('tr, .stat, .metric, li'));
        const hit = nodes.find((n) => n.textContent?.toLowerCase().includes(label.toLowerCase()));
        if (!hit) return null;
        const val = hit.querySelector('td:last-child, .value, span:last-child');
        return (val?.textContent ?? hit.textContent)?.trim() ?? null;
      };
      const text = (sel: string): string | null => document.querySelector(sel)?.textContent?.trim() ?? null;
      return {
        company: text('h1') ?? text('.company-name'),
        sector: byLabel('sector'),
        price: byLabel('current price') ?? byLabel('last price') ?? text('.price'),
        change: byLabel('change'),
        changePercent: byLabel('change %') ?? byLabel('percent'),
        volume: byLabel('volume'),
        high: byLabel('day high') ?? byLabel('high'),
        low: byLabel('day low') ?? byLabel('low'),
        open: byLabel('open'),
        marketCap: byLabel('market cap'),
        pe: byLabel('p/e') ?? byLabel('pe ratio'),
        pb: byLabel('p/b') ?? byLabel('pb ratio'),
        roe: byLabel('roe'),
        roa: byLabel('roa'),
        dividendYield: byLabel('dividend yield'),
        beta: byLabel('beta'),
        eps: byLabel('eps'),
      };
    });

    const financials: FinancialDTO[] = [];
    const eps = toNumber(data.eps);
    if (eps !== null) {
      financials.push({
        year: new Date().getFullYear(),
        quarter: null,
        eps,
        sales: null,
        profitAfterTax: null,
        assets: null,
        liabilities: null,
        equity: null,
      });
    }
    const dividends: DividendDTO[] = [];

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
      dividends,
      financials,
      ratios: {
        peRatio: toNumber(data.pe),
        pbRatio: toNumber(data.pb),
        roe: toNumber(data.roe),
        roa: toNumber(data.roa),
        dividendYield: toNumber(data.dividendYield),
        beta: toNumber(data.beta),
      },
    };
    logger.debug('sarmaaya.scraped', { symbol, hasRatios: !!result.ratios });
    return result;
  }
}
