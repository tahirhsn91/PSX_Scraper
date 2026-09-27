import { scraperRegistry } from './registry';
import { scrapeResultSchema } from './result.schema';
import { childLogger } from '../utils/logger';
import { ScrapeResult, ProviderOutcome, RatioDTO, DividendDTO } from '../types/dto';
import { InvalidSymbolError } from '../types/errors';
import { SARMAYA_FUNDAMENTALS_SOURCE } from './sarmaayaFundamentals.scraper';

export interface OrchestrationResult {
  result: ScrapeResult;
  outcomes: ProviderOutcome[];
  partial: boolean;
}

const pick = <T>(...vals: (T | null | undefined)[]): T | null => {
  for (const v of vals) if (v !== null && v !== undefined) return v;
  return null;
};

/**
 * Merge ratio blocks **field by field**, in precedence order.
 *
 * A whole-block `pick()` throws the losing providers away, so a provider that answered while the
 * primary refused contributes nothing: the Sarmaaya page parse carries no book value at all, and
 * the JSON legs carry no beta, so a block-level choice blanks one of them whichever way it is
 * ordered. Each field therefore takes the first provider that actually stated a value, and a field
 * nobody supplied stays null — which the dashboard renders as a dash.
 */
export function mergeRatios(...blocks: Array<RatioDTO | null | undefined>): RatioDTO | null {
  const present = blocks.filter((b): b is RatioDTO => b !== null && b !== undefined);
  if (present.length === 0) return null;
  return {
    peRatio: pick(...present.map((b) => b.peRatio)),
    pbRatio: pick(...present.map((b) => b.pbRatio)),
    roe: pick(...present.map((b) => b.roe)),
    roa: pick(...present.map((b) => b.roa)),
    dividendYield: pick(...present.map((b) => b.dividendYield)),
    bookValue: pick(...present.map((b) => b.bookValue)),
    beta: pick(...present.map((b) => b.beta)),
  };
}

/**
 * Dividend rows from every provider that published any, newest announcement first, one row per
 * announcement date. The table is unique on `(stock_id, announcement_date)`, so two providers
 * describing the same announcement are one row and the higher-precedence provider wins.
 */
export function mergeDividends(...lists: DividendDTO[][]): DividendDTO[] {
  const byDate = new Map<string, DividendDTO>();
  for (const list of lists) {
    for (const row of list) {
      if (!row.announcementDate) continue;
      if (byDate.has(row.announcementDate)) continue;
      byDate.set(row.announcementDate, row);
    }
  }
  return [...byDate.values()].sort((a, b) =>
    (b.announcementDate ?? '').localeCompare(a.announcementDate ?? ''),
  );
}

/**
 * Run all enabled scrapers, merge with documented precedence, validate output.
 * Partial success supported: if one provider fails, the other's data still persists.
 * Precedence: price from PSX, ratios/financials from Sarmaaya, company info first-non-null.
 */
export async function scrapeSymbol(symbol: string): Promise<OrchestrationResult> {
  const log = childLogger({ symbol, op: 'orchestrate' });
  const scrapers = scraperRegistry.enabled();

  const settled = await Promise.allSettled(scrapers.map((s) => s.scrape(symbol)));

  const outcomes: ProviderOutcome[] = [];
  const bySource = new Map<string, ScrapeResult>();
  let invalidCount = 0;

  settled.forEach((res, i) => {
    const source = scrapers[i]!.source;
    if (res.status === 'fulfilled') {
      outcomes.push({ source, ok: true });
      bySource.set(source, res.value);
    } else {
      const err = res.reason;
      if (err instanceof InvalidSymbolError) invalidCount++;
      outcomes.push({ source, ok: false, error: err instanceof Error ? err.message : String(err) });
      log.warn('provider.failed', { source, error: err instanceof Error ? err.message : String(err) });
    }
  });

  if (bySource.size === 0) {
    // Every provider failed. If all say invalid symbol, propagate that (permanent).
    if (invalidCount === scrapers.length) throw new InvalidSymbolError(symbol);
    throw new Error(`All scrapers failed for ${symbol}: ${outcomes.map((o) => o.error).join('; ')}`);
  }

  const psx = bySource.get('psx');
  const sarmaaya = bySource.get('sarmaaya');
  // The plain-HTTP JSON leg (#79): ratios, book value per share and the dividend history.
  const fundamentals = bySource.get(SARMAYA_FUNDAMENTALS_SOURCE);

  // The price block comes from one provider (PSX preferred), but the 52-week pair is worth
  // filling field-by-field: both providers publish it, and either can be the one that
  // actually answered — Sarmaaya is what keeps the columns populated while PSX refuses us.
  const chosenPrice = pick(psx?.price, sarmaaya?.price);
  const price = chosenPrice
    ? {
        ...chosenPrice,
        week52High: pick(psx?.price?.week52High, sarmaaya?.price?.week52High),
        week52Low: pick(psx?.price?.week52Low, sarmaaya?.price?.week52Low),
        // Field-by-field for the same reason as the pair above: a whole-block pick throws the
        // losing provider's market cap away, so a provider that read nothing on a given run
        // blanks a value the other one actually had (#71).
        marketCap: pick(psx?.price?.marketCap, sarmaaya?.price?.marketCap),
      }
    : null;

  const merged: ScrapeResult = {
    symbol: symbol.toUpperCase(),
    companyName: pick(psx?.companyName, sarmaaya?.companyName, fundamentals?.companyName),
    sector: pick(psx?.sector, sarmaaya?.sector, fundamentals?.sector),
    price,
    // Field-by-field, and the JSON leg first: it is the only provider that reads book value per
    // share, and the page's ratio block is the one that has been coming back empty for the board.
    ratios: mergeRatios(fundamentals?.ratios, sarmaaya?.ratios, psx?.ratios),
    financials: [...(sarmaaya?.financials ?? []), ...(psx?.financials ?? [])],
    dividends: mergeDividends(
      fundamentals?.dividends ?? [],
      sarmaaya?.dividends ?? [],
      psx?.dividends ?? [],
    ),
  };

  const validated = scrapeResultSchema.parse(merged);
  const partial = outcomes.some((o) => !o.ok);
  log.info('orchestrate.done', { partial, providers: outcomes });
  return { result: validated as ScrapeResult, outcomes, partial };
}
