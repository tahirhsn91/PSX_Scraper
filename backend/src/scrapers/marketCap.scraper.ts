import { logger } from '../utils/logger';

/**
 * Market cap, fetched directly rather than parsed out of a company page.
 *
 * Why this exists (issue #71): the only publisher of a per-symbol cap is PSX's own company page,
 * and that path is refused at the edge — every `dps.psx.com.pk/<segment>` returns an empty reply
 * in ~0.1s while the site root answers 200, with or without a session cookie or HTTP/1.1. So the
 * extractor in `psx.scraper.ts` (now scoped to the labelled stats item and unit-tested) has
 * nothing to read. Until that path answers again, caps come from two sources that do:
 *
 *   1. TradingView's public scanner — ONE POST returns every PSX symbol. ~355 of our 508 rows
 *      carry a value; the rest come back null.
 *   2. stockanalysis.com's per-symbol page, for those gaps (illiquid small caps mostly). One
 *      request per symbol, spaced out.
 *
 * Both report rupees for PSX symbols. They are aggregators, so a figure can differ from PSX's own
 * by a few percent; if the PSX path is ever unblocked its reading should be preferred.
 */

export interface MarketCapSnapshot {
  symbol: string;
  marketCap: number;
  source: 'tradingview' | 'stockanalysis';
}

export const SCANNER_URL = 'https://scanner.tradingview.com/pakistan/scan';
export const STOCKANALYSIS_URL = 'https://stockanalysis.com/quote/psx';

/** The scanner columns this needs: symbol, cap, price. `market_cap_basic` is rupees for PSX. */
export const SCANNER_COLUMNS = ['name', 'market_cap_basic', 'close'] as const;

/** Position of the cap in a scanner row — fixed by the column list above, and pinned by a test. */
export const CAP_COLUMN_INDEX = 1;

/** The scanner takes a ticker set per request; 250 keeps us well inside what it accepts. */
const SCANNER_BATCH_SIZE = 250;

/**
 * Below this, a number is a parse artefact rather than a valuation: PSX's smallest tracked caps
 * are hundreds of millions of rupees. Guarding here means a layout change upstream reads as "no
 * value" instead of as a wrong one.
 */
const MIN_PLAUSIBLE_CAP = 1_000_000;

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Spacing between the per-symbol requests, so the gap-fill is not a burst. */
const GAP_FILL_DELAY_MS = 900;

/**
 * `1.39B` / `12.4M` / `1.2T` -> rupees. Null for anything that is not a positive amount.
 */
export function parseCompactAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/^\s*([0-9]*\.?[0-9]+)\s*([TBMK])?\s*$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const suffix = (match[2] || '').toUpperCase();
  const scales: Record<string, number> = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 };
  return value * (scales[suffix] ?? 1);
}

/** The label cell, then the value cell. Shared by the parser and by its tests' fixtures. */
export const CAP_CELL_PATTERN =
  /<td[^>]*>[\s\S]{0,160}?Market Cap[\s\S]{0,40}?<\/td>[\s\S]{0,300}?<td[^>]*>\s*([^<]{1,24})/i;

/**
 * The Market Cap figure on a stockanalysis.com quote page.
 *
 * The label is a table cell whose whole content is "Market Cap" — sometimes that is an anchor into
 * the site's dedicated `market-cap/` page (ordinary shares), sometimes plain text between HTML
 * comments (preference shares, rights). Anchoring on `Market Cap` *inside a cell* and then reading
 * the next cell covers both shapes without matching a nav item, a heading, or the change badge
 * (`+124.8%`) that sits beside the value. Returns null when the layout is not what we know, because
 * "no value" is recoverable and a wrong number is not.
 */
export function parseStockanalysisMarketCap(html: string | null | undefined): number | null {
  if (!html) return null;
  const cell = html.match(CAP_CELL_PATTERN);
  if (!cell) return null;
  // parseCompactAmount already strips thousands separators; the cell may carry trailing markup
  // that the capture stops short of, so only whitespace needs trimming here.
  const amount = parseCompactAmount((cell[1] ?? '').trim());
  return amount != null && amount >= MIN_PLAUSIBLE_CAP ? amount : null;
}

/**
 * Scanner rows -> snapshots.
 *
 * The ticker-set query answers as `{ s: 'PSX:FFC', d: [name, market_cap_basic, close] }`, so the
 * symbol comes from `s` (stripped of its exchange prefix) and the cap from the fixed column
 * position. A null, absent or non-numeric cap is a gap, never a zero, and a duplicate keeps its
 * largest reading so one bad row cannot overwrite a good one.
 */
export function parseTradingViewRows(payload: unknown): MarketCapSnapshot[] {
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  const bySymbol = new Map<string, number>();
  for (const row of rows) {
    const candidate = row as { s?: unknown; d?: unknown };
    const symbol = String(candidate.s ?? '').split(':').pop()?.trim().toUpperCase() ?? '';
    const cells = Array.isArray(candidate.d) ? candidate.d : [];
    const raw = cells[CAP_COLUMN_INDEX];
    const cap = typeof raw === 'number' ? raw : Number(raw);
    if (!symbol || !Number.isFinite(cap) || cap < MIN_PLAUSIBLE_CAP) continue;
    const previous = bySymbol.get(symbol);
    if (previous == null || cap > previous) bySymbol.set(symbol, cap);
  }
  return [...bySymbol].map(([symbol, marketCap]) => ({
    symbol,
    marketCap: Math.round(marketCap),
    source: 'tradingview' as const,
  }));
}

/**
 * Caps for `symbols` in as few requests as the scanner allows: one ticker-set POST per
 * SCANNER_BATCH_SIZE symbols. Empty on total failure — the caller then falls to stockanalysis,
 * and anything still missing stays a dash.
 */
export async function fetchTradingViewMarketCaps(symbols: string[]): Promise<MarketCapSnapshot[]> {
  const snapshots: MarketCapSnapshot[] = [];
  for (let i = 0; i < symbols.length; i += SCANNER_BATCH_SIZE) {
    const batch = symbols.slice(i, i + SCANNER_BATCH_SIZE);
    try {
      const res = await fetch(SCANNER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA },
        body: JSON.stringify({
          symbols: { tickers: batch.map((s) => `PSX:${s}`), query: { types: [] } },
          columns: [...SCANNER_COLUMNS],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        logger.warn('marketcap.scanner_failed', { status: res.status, batch: batch.length });
        continue;
      }
      snapshots.push(...parseTradingViewRows(await res.json()));
    } catch (err) {
      logger.warn('marketcap.scanner_failed', { error: (err as Error).message });
    }
  }
  logger.info('marketcap.scanner_ok', { requested: symbols.length, withCap: snapshots.length });
  return snapshots;
}

/** Wait helper, so the gap-fill's back-off reads as a pause rather than a magic number. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One symbol's cap from stockanalysis.com.
 *
 * The gap-fill is a long sequential walk (~150 pages) and this host rate-limits bursts, so a 429
 * or a 5xx is retried with back-off rather than recorded as a miss: those symbols do have a value,
 * and a transient refusal must not become a permanent dash. A page we *did* read and could not
 * parse returns null immediately — retrying that would only cost requests.
 */
export async function fetchStockanalysisMarketCap(symbol: string, attempts = 3): Promise<number | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(`${STOCKANALYSIS_URL}/${encodeURIComponent(symbol)}/`, {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 429 || res.status >= 500) {
        logger.warn('marketcap.gap_fill_backoff', { symbol, status: res.status, attempt });
        await sleep(600 * attempt * attempt);
        continue;
      }
      if (!res.ok) return null;
      return parseStockanalysisMarketCap(await res.text());
    } catch (err) {
      logger.warn('marketcap.gap_fill_error', { symbol, attempt, error: (err as Error).message });
      await sleep(400 * attempt);
    }
  }
  return null;
}

export interface MarketCapFetchResult {
  snapshots: MarketCapSnapshot[];
  /** Tracked symbols neither source reported a cap for. Stays a gap; never filled with a guess. */
  missing: string[];
  errors: number;
}

/**
 * Caps for `symbols`: the scanner first (a few batched POSTs), then stockanalysis for whatever it
 * left out, spaced. `missing` is the honest remainder — the dashboard shows those as a dash.
 *
 * `scanner: false` runs only the per-symbol walk, which is what the service uses for the *gaps*
 * once the scanner has done its pass: repeating the bulk query for symbols it cannot serve would
 * spend requests to learn nothing.
 */
export async function fetchMarketCaps(
  symbols: string[],
  options: { delayMs?: number; scanner?: boolean } = {},
): Promise<MarketCapFetchResult> {
  const wanted = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const wantedSet = new Set(wanted);
  const found = new Map<string, MarketCapSnapshot>();

  if (options.scanner !== false) {
    for (const snapshot of await fetchTradingViewMarketCaps(wanted)) {
      if (wantedSet.has(snapshot.symbol)) found.set(snapshot.symbol, snapshot);
    }
  }

  const gaps = wanted.filter((s) => !found.has(s));
  let errors = 0;
  for (const symbol of gaps) {
    const cap = await fetchStockanalysisMarketCap(symbol);
    if (cap == null) {
      errors += 1;
    } else {
      found.set(symbol, { symbol, marketCap: cap, source: 'stockanalysis' });
    }
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? GAP_FILL_DELAY_MS));
  }

  const snapshots = [...found.values()];
  logger.info('marketcap.fetch_done', {
    wanted: wanted.length,
    fromScanner: snapshots.filter((s) => s.source === 'tradingview').length,
    fromStockanalysis: snapshots.filter((s) => s.source === 'stockanalysis').length,
    missing: wanted.length - snapshots.length,
  });
  return { snapshots, missing: wanted.filter((s) => !found.has(s)), errors };
}
