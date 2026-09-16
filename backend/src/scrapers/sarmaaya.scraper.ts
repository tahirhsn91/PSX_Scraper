import { Page } from 'puppeteer';
import { browserPool } from './browserPool';
import { toNumber, toIsoDate, parseWeek52Range } from './parse.utils';
import { logger } from '../utils/logger';
import { IStockScraper } from '../types/scraper';
import { ScrapeResult, FinancialDTO, DividendDTO } from '../types/dto';
import { InvalidSymbolError, NavigationTimeoutError, SiteUnavailableError } from '../types/errors';

/** Raw strings read off the Sarmaaya stock page, before parsing. */
export interface SarmaayaPageData {
  company: string | null;
  sector: string | null;
  week52Low: string | null;
  week52High: string | null;
  quoteDate: string | null;
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
    /**
     * The low/high pair printed under a label such as "52 week range": the page renders
     * `<p>52 week range</p>` followed by a range bar whose two numeric `<span>`s are the
     * endpoints. Reads the spans of the label's own parent, so a neighbouring block's
     * numbers can never be picked up (the failure mode that produced #21 on the PSX page).
     *
     * Sarmaaya renders the block twice (responsive duplicate) — both carry the same values,
     * so the first hit with two numbers wins. Returns null when nothing numeric is found.
     */
    labelledPair(pattern: RegExp): { low: string; high: string } | null {
      const labels = Array.from(document.querySelectorAll('p'));
      const hits = labels.filter((p) => pattern.test(p.textContent ?? ''));
      for (const hit of hits) {
        const box = hit.parentElement;
        if (!box) continue;
        const nums = Array.from(box.querySelectorAll('span'))
          .map((s) => (s.textContent ?? '').trim())
          .filter((t) => /^[\d,]+(\.\d+)?$/.test(t));
        if (nums.length >= 2) {
          return { low: nums[nums.length - 2]!, high: nums[nums.length - 1]! };
        }
      }
      return null;
    },
    /**
     * The quote object Sarmaaya embeds in its own Next.js payload — the authoritative
     * source for this page, and the reason the old selector sweep found nothing after the
     * site was rewritten (#29): the values are not in `tr`/`.stat`/`.metric` markup any
     * more, they are in a `<script>` as `{"symbol":…,"close":…,"high52":…}`.
     *
     * The payload sits inside a JS string, so quotes arrive escaped (`\"close\"`); it is
     * unescaped before matching. The object itself is flat, so a flat `{…}` match is exact —
     * and a shape change degrades to null rather than to a wrong number.
     */
    embeddedQuote(): Record<string, unknown> | null {
      const blob = Array.from(document.querySelectorAll('script'))
        .map((s) => s.textContent ?? '')
        .join('\n');
      const hit = blob
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .match(/\{[^{}]*"high52"[^{}]*\}/);
      if (!hit) return null;
      try {
        return JSON.parse(hit[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    /** Numbers/strings off the embedded quote as text, so the worker does the parsing. */
    asText(value: unknown): string | null {
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
      return null;
    },
    /** Sector name from the page's own meta description ("… under the FERTILIZER sector"). */
    metaSector(): string | null {
      const content =
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
      return content.match(/under the (.+?) sector/i)?.[1]?.trim() ?? null;
    },
  };

  const q = H.embeddedQuote();
  const week52 = H.labelledPair(/52\s*week\s*range/i);

  // Missing fields => null (never fabricated). The embedded quote carries everything the
  // quote block needs; `labelledPair` stays as the fallback for the 52-week pair only.
  return {
    company: H.asText(q?.name) ?? H.text('h1'),
    sector: H.metaSector(),
    week52Low: H.asText(q?.low52) ?? week52?.low ?? null,
    week52High: H.asText(q?.high52) ?? week52?.high ?? null,
    quoteDate: H.asText(q?.date),
    price: H.asText(q?.close) ?? H.byLabel('current price') ?? H.text('.price'),
    change: H.asText(q?.change) ?? H.byLabel('change'),
    changePercent: H.asText(q?.change_percentage) ?? H.byLabel('change %'),
    volume: H.asText(q?.volume) ?? H.byLabel('volume'),
    high: H.asText(q?.high) ?? H.byLabel('day high'),
    low: H.asText(q?.low) ?? H.byLabel('day low'),
    open: H.asText(q?.open) ?? H.byLabel('open'),
    marketCap: H.asText(q?.market_cap) ?? H.byLabel('market cap'),
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
        // Sarmaaya does publish the 52-week range (it was wrongly assumed absent in #25):
        // same pair PSX reports for the same symbol, so it doubles as the fallback source
        // when PSX refuses us. Its 0.0/0.0 placeholders become null in parseWeek52Range.
        week52High: week52.high,
        week52Low: week52.low,
        // The page carries its own quote timestamp ("16 Sep 02:14 PM" rendered, ISO in the
        // payload) — prefer it over `now()`, so a row says when the exchange printed the
        // price rather than when we happened to fetch it.
        lastTradeDate: toIsoDate(data.quoteDate) ?? toIsoDate(new Date().toISOString()),
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
