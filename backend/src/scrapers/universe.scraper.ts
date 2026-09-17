import { logger } from '../utils/logger';

/**
 * The PSX universe, as this host can actually see it.
 *
 * PSX's own listings and bulk endpoints refuse us (#27 — `dps.psx.com.pk` answers `http=000` for
 * `/market-watch`, `/company/<SYM>` and `/timeseries/eod/<SYM>`), so the universe comes from the
 * source we *can* reach: Sarmaaya publishes one page per listed security in its sitemap. That is
 * a single static request which enumerates the whole board without rendering anything.
 *
 * Measured 2026-09-17: 2207 sitemap entries, 509 under `/stocks/<SYM>`, 9 under `/etf/<slug>`,
 * and one non-symbol slug (`/stocks/compare`). The `/stocks` set already spans the security types
 * we were asked to cover — preference shares appear (`AGLNCPS`), so do ETFs (`ACIETF`) — and
 * delisted symbols are absent (`ENGRO` is not listed, its successor `ENGROH` is), which is the
 * property that keeps a dead symbol off the dashboard.
 */
export const DEFAULT_SITEMAP_URL = 'https://sarmaaya.pk/sitemap.xml';

/**
 * Identify ourselves. The backend sent no User-Agent at all before this (part of #27), which is
 * exactly the sort of thing that invites a source to start refusing a host.
 */
export const SCRAPER_USER_AGENT =
  'PSX-Scraper/1.0 (+https://github.com/tahirhsn91/PSX_Scraper)';

/** Slugs that live under a security path but are pages, not securities. */
const NON_SYMBOL_SLUGS = new Set(['COMPARE']);

/** A PSX ticker is short and alphanumeric; anything else under /stocks/ is a page. */
const SYMBOL_SHAPE = /^[A-Z0-9]{1,12}$/;

export interface UniverseDiscovery {
  symbols: string[];
  fetchedAt: Date;
}

/**
 * Extract the listed symbols from a sitemap document.
 *
 * Pure, so it is tested against a real excerpt rather than a mock. `/stocks/<SYM>` and
 * `/etf/<slug>` both count: some ETF pages are not duplicated under `/stocks`, and the union is
 * the closest thing to "everything PSX lists" available from this host.
 */
export function parseUniverseSitemap(xml: string): string[] {
  const found = new Set<string>();
  const re = /<loc>\s*https?:\/\/[^/<>]+\/(?:stocks|etf)\/([^<\s/?#]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    let slug: string;
    try {
      slug = decodeURIComponent(m[1]!).trim().toUpperCase();
    } catch {
      continue; // malformed escape — not a ticker
    }
    if (NON_SYMBOL_SLUGS.has(slug) || !SYMBOL_SHAPE.test(slug)) continue;
    found.add(slug);
  }
  return [...found].sort();
}

/**
 * Fetch and parse the universe.
 *
 * Throws on a non-200 so the caller fails the pass and backs off, rather than walking an empty
 * list and reporting a clean run that did nothing.
 */
export async function fetchUniverse(
  sitemapUrl: string = DEFAULT_SITEMAP_URL,
  timeoutMs = 20_000,
): Promise<UniverseDiscovery> {
  const res = await fetch(sitemapUrl, {
    headers: { 'User-Agent': SCRAPER_USER_AGENT, Accept: 'application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Universe sitemap fetch failed: HTTP ${res.status}`);

  const symbols = parseUniverseSitemap(await res.text());
  if (symbols.length === 0) throw new Error('Universe sitemap parsed to zero symbols');

  logger.info('universe.discovered', { symbols: symbols.length, url: sitemapUrl });
  return { symbols, fetchedAt: new Date() };
}
