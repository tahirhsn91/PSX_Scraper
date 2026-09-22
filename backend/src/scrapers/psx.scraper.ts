import { Page } from 'puppeteer';
import { browserPool } from './browserPool';
import { toNumber, toIsoDate, parseWeek52Range } from './parse.utils';
import { logger } from '../utils/logger';
import {
  IStockScraper,
} from '../types/scraper';
import { ScrapeResult } from '../types/dto';
import { InvalidSymbolError, NavigationTimeoutError, SiteUnavailableError } from '../types/errors';
import { recordSourceFailure, sourceBreaker } from '../utils/sourceBreaker';

/** Raw strings read off the DPS company page, before parsing. */
export interface PsxPageData {
  company: string | null;
  sector: string | null;
  week52Low: string | null;
  week52High: string | null;
  price: string | null;
  change: string | null;
  changePercent: string | null;
  volume: string | null;
  high: string | null;
  low: string | null;
  open: string | null;
  marketCap: string | null;
}

/**
 * Extracts the quote block from https://dps.psx.com.pk/company/{SYMBOL}.
 *
 * This function does NOT run in the worker — Puppeteer serialises it with
 * Function.prototype.toString() and evaluates it inside the browser page, so its
 * body has to survive that round trip. Two rules, both enforced by
 * tests/scraper-serialisation.test.ts:
 *
 *   1. Reference nothing from module scope. The browser cannot see this module,
 *      so helpers and constants must be declared inside, and any input must be
 *      passed through `page.evaluate(fn, ...args)`.
 *   2. Declare no named functions and no function-valued variables here — no
 *      `function foo() {}` and no `const foo = () => {}`. Bundlers add
 *      name-preserving wrappers around those (esbuild's `keepNames`, switched on
 *      by tsx), which rewrite the source Puppeteer serialises into
 *      `__name(fn, "foo")`; `__name` does not exist in the browser, so every
 *      call threw "ReferenceError: __name is not defined" and both providers
 *      failed on every sync.
 *
 * Object-literal shorthand methods (`{ text() {} }`) and inline anonymous
 * callbacks (`.find((n) => …)`) are left alone by the transform and are safe.
 */
export function extractPsxPageData(): PsxPageData {
  const H = {
    text(sel: string): string | null {
      return document.querySelector(sel)?.textContent?.trim() ?? null;
    },
    byLabel(label: string): string | null {
      const nodes = Array.from(
        document.querySelectorAll('.stats_item, .quote__item, .company__title, td, div'),
      );
      const hit = nodes.find((n) => n.textContent?.toLowerCase().includes(label.toLowerCase()));
      return hit?.textContent?.trim() ?? null;
    },
    /**
     * The low/high pair from the stats item whose label matches `pattern` — the
     * "52-WEEK RANGE" box. Reads the machine-readable data-low/data-high attributes of the
     * inner `.numRange` node, falling back to splitting the displayed "441.70 — 685.00".
     *
     * Scoped to the labelled item on purpose: `byLabel()` above matches the first node whose
     * text merely *contains* a word, which is how the day high/low currently pick up a whole
     * concatenated stats block (#21). Null when the page has no such item — a missing range
     * must stay missing instead of borrowing a number from a neighbouring box.
     */
    labelledRange(pattern: RegExp): { low: string | null; high: string | null } | null {
      const items = Array.from(document.querySelectorAll('.stats_item'));
      const hit = items.find((item) =>
        pattern.test(item.querySelector('.stats_label')?.textContent ?? ''),
      );
      if (!hit) return null;

      const num = hit.querySelector('.numRange');
      const attrLow = num?.getAttribute('data-low') ?? null;
      const attrHigh = num?.getAttribute('data-high') ?? null;
      if (attrLow !== null || attrHigh !== null) return { low: attrLow, high: attrHigh };

      const parts = (hit.querySelector('.stats_value')?.textContent ?? '').split(/[—–]/);
      return { low: parts[0]?.trim() || null, high: parts[1]?.trim() || null };
    },
  };

  const week52 = H.labelledRange(/52-?week/i);

  // Missing fields => null (never fabricated).
  return {
    company: H.text('.quote__name') ?? H.text('h1') ?? H.text('.company__title'),
    sector: H.text('.quote__sector') ?? H.byLabel('sector'),
    week52Low: week52?.low ?? null,
    week52High: week52?.high ?? null,
    price: H.text('.quote__close') ?? H.text('[data-field="price"]'),
    change: H.text('.quote__change'),
    changePercent: H.text('.quote__change_percent') ?? H.text('.change__percent'),
    volume: H.byLabel('volume'),
    high: H.byLabel('high'),
    low: H.byLabel('low'),
    open: H.byLabel('open'),
    marketCap: H.byLabel('market cap'),
  };
}

/**
 * Scraper for https://dps.psx.com.pk/company/{SYMBOL}
 * Selectors are centralized so markup drift is a config change, not a code change.
 */
export class PSXScraper implements IStockScraper {
  readonly source = 'psx';

  private readonly baseUrl = 'https://dps.psx.com.pk/company';

  async scrape(symbol: string): Promise<ScrapeResult> {
    const sym = symbol.toUpperCase();
    // The company page shares its host with the time-series endpoints, so the breaker that a
    // refused history fetch opens also stops this scrape from adding to the volume (#27).
    sourceBreaker.assertAvailable(this.source);
    return browserPool.withPage(async (page) => {
      try {
        const result = await this.run(page, sym);
        sourceBreaker.recordSuccess(this.source);
        return result;
      } catch (err) {
        recordSourceFailure(this.source, err);
        throw err;
      }
    });
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

    // Passed by reference (never as an inline arrow) — see extractPsxPageData.
    const data = await page.evaluate(extractPsxPageData);
    const week52 = parseWeek52Range(data.week52Low, data.week52High);

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
        week52High: week52.high,
        week52Low: week52.low,
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
