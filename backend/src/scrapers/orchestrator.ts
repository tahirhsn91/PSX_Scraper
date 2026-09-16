import { scraperRegistry } from './registry';
import { scrapeResultSchema } from './result.schema';
import { childLogger } from '../utils/logger';
import { ScrapeResult, ProviderOutcome } from '../types/dto';
import { InvalidSymbolError } from '../types/errors';

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

  // The price block comes from one provider (PSX preferred), but the 52-week pair is worth
  // filling field-by-field: both providers publish it, and either can be the one that
  // actually answered — Sarmaaya is what keeps the columns populated while PSX refuses us.
  const chosenPrice = pick(psx?.price, sarmaaya?.price);
  const price = chosenPrice
    ? {
        ...chosenPrice,
        week52High: pick(psx?.price?.week52High, sarmaaya?.price?.week52High),
        week52Low: pick(psx?.price?.week52Low, sarmaaya?.price?.week52Low),
      }
    : null;

  const merged: ScrapeResult = {
    symbol: symbol.toUpperCase(),
    companyName: pick(psx?.companyName, sarmaaya?.companyName),
    sector: pick(psx?.sector, sarmaaya?.sector),
    price,
    ratios: pick(sarmaaya?.ratios, psx?.ratios),
    financials: [...(sarmaaya?.financials ?? []), ...(psx?.financials ?? [])],
    dividends: [...(sarmaaya?.dividends ?? []), ...(psx?.dividends ?? [])],
  };

  const validated = scrapeResultSchema.parse(merged);
  const partial = outcomes.some((o) => !o.ok);
  log.info('orchestrate.done', { partial, providers: outcomes });
  return { result: validated as ScrapeResult, outcomes, partial };
}
