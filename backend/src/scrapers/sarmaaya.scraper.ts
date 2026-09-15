import { Page } from 'puppeteer';
import { browserPool } from './browserPool';
import { toNumber, toIsoDate } from './parse.utils';
import { logger } from '../utils/logger';
import { IStockScraper } from '../types/scraper';
import { ScrapeResult, FinancialDTO, DividendDTO } from '../types/dto';
import { InvalidSymbolError, NavigationTimeoutError, SiteUnavailableError } from '../types/errors';

/** Raw strings read off the Sarmaaya stock page, before parsing. */
export interface SarmaayaPageData {
  company: string | null;
  sector: string | null;
  price: string | null;
  change: string | null;
  changePercent: string | null;
  volume: string | null;
  high: string | null;
  low: string | null;
  open: string | null;
  marketCap: string | null;
  pe: string | null;
  pb: string | null;
  roe: string | null;
  roa: string | null;
  dividendYield: string | null;
  beta: string | null;
  eps: string | null;
}

/**
 * Extracts the quote/ratio block from https://sarmaaya.pk/stocks/{SYMBOL}.
 *
 * Like its PSX counterpart this runs INSIDE the browser page, not in the worker:
 * Puppeteer serialises it with Function.prototype.toString() and evaluates that
 * source in the page. It must therefore reference nothing from module scope (pass
 * inputs via `page.evaluate(fn, ...args)`), and it must contain no named functions
 * or function-valued variables — bundler name-preserving wrappers (esbuild's
 * `keepNames`, which tsx enables) turn those into `__name(fn, "fn")` calls that
 * do not exist in the browser and broke every sync with
 * "ReferenceError: __name is not defined". Shorthand methods on an object literal
 * and inline anonymous callbacks are safe; see tests/scraper-serialisation.test.ts.
 */
export function extractSarmaayaPageData(): SarmaayaPageData {
  const H = {
    text(sel: string): string | null {
      return document.querySelector(sel)?.textContent?.trim() ?? null;
    },
    byLabel(label: string): string | null {
      const nodes = Array.from(document.querySelectorAll('tr, .stat, .metric, li'));
      const hit = nodes.find((n) => n.textContent?.toLowerCase().includes(label.toLowerCase()));
      if (!hit) return null;
      const val = hit.querySelector('td:last-child, .value, span:last-child');
      return (val?.textContent ?? hit.textContent)?.trim() ?? null;
    },
  };

  // Missing fields => null (never fabricated).
  return {
    company: H.text('h1') ?? H.text('.company-name'),
    sector: H.byLabel('sector'),
    price: H.byLabel('current price') ?? H.byLabel('last price') ?? H.text('.price'),
    change: H.byLabel('change'),
    changePercent: H.byLabel('change %') ?? H.byLabel('percent'),
    volume: H.byLabel('volume'),
    high: H.byLabel('day high') ?? H.byLabel('high'),
    low: H.byLabel('day low') ?? H.byLabel('low'),
    open: H.byLabel('open'),
    marketCap: H.byLabel('market cap'),
    pe: H.byLabel('p/e') ?? H.byLabel('pe ratio'),
    pb: H.byLabel('p/b') ?? H.byLabel('pb ratio'),
    roe: H.byLabel('roe'),
    roa: H.byLabel('roa'),
    dividendYield: H.byLabel('dividend yield'),
    beta: H.byLabel('beta'),
    eps: H.byLabel('eps'),
  };
}

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

    // Passed by reference (never as an inline arrow) — see extractSarmaayaPageData.
    const data = await page.evaluate(extractSarmaayaPageData);

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
        // Sarmaaya publishes no 52-week range, so the field is honestly absent (#25):
        // the merge keeps PSX's pair and reports null when PSX itself had none.
        week52High: null,
        week52Low: null,
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
