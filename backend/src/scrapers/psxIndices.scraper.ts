import { childLogger } from '../utils/logger';
import { SiteUnavailableError } from '../types/errors';

/**
 * The PSX index board, from the exchange's own market-summary page.
 *
 * `dps.psx.com.pk` — where our index *history* comes from — refuses this host on every data
 * path, which is why the dashboard's KSE-100 has been frozen. The corporate site at
 * `www.psx.com.pk` is reachable, and its market-summary page carries an "Indices" carousel with
 * every index PSX publishes: symbol, level, point change and percent, each tagged up/dwn.
 *
 * The list is read from the page, never from a constant. Whatever PSX lists is what we track,
 * so an index added or retired there needs no change here — and the set is verifiable: the page
 * returned 17 indices, and Sarmaaya's sitemap independently lists the same 17 index pages.
 *
 * Parsed shape, from the live markup:
 *
 *   <div class="item indices-single">
 *     <div class="col-xs-6"><h3>KSE100</h3><h4>171153.16</h4></div>
 *     <div class="col-xs-6"><h5 class="up">268.58</h5><h6 class="up">(0.16%)</h6></div>
 *   </div>
 */
export interface ParsedIndex {
  symbol: string;
  /** Index level. A block without one is skipped rather than guessed. */
  level: number;
  /** Point change, null when the page did not report one. */
  change: number | null;
  /** Percent change, null when the page did not report one. */
  changePercent: number | null;
  direction: 'up' | 'down' | 'flat';
  /**
   * When the source says the reading was taken — only Sarmaaya's market-view says at all; the
   * exchange's page carries no timestamp, which is why a frozen board cannot be told from a quiet
   * one there. Null means "this source cannot say", and a reading that cannot point at a time
   * cannot prove it is live (see the in-session refusal in indexScrape.service).
   */
  readAt?: Date | null;
  /**
   * Shares traded in the session, when the source publishes a figure. Null means "not published",
   * never zero — the exchange stopped serving index volume on 2026-09-22 and its carousel never
   * carried one.
   */
  volume?: number | null;
}

const PAGE = 'https://www.psx.com.pk/market-summary';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/** Inner text of the first `<tag>` in a fragment, tags stripped. */
function tag(fragment: string, name: string): string | null {
  const m = new RegExp(`<${name}[^>]*>(.*?)</${name}>`, 'is').exec(fragment);
  return m ? m[1]!.replace(/<[^>]+>/g, '').trim() : null;
}

/** A number, or null when the text is not one. Never coerced to zero. */
function num(text: string | null): number | null {
  if (text === null) return null;
  const cleaned = text.replace(/[()%\s,]/g, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * A signed reading: the page marks direction with a class (`up` / `dwn`) and repeats the sign
 * in the text. The class is preferred when present; otherwise the sign decides. A value the
 * page renders without either is reported as flat rather than assumed to be a gain.
 */
function signed(fragment: string, name: string): { value: number | null; direction: 'up' | 'down' | 'flat' } {
  const m = new RegExp(`<${name}[^>]*class="([^"]*)"[^>]*>(.*?)</${name}>`, 'is').exec(fragment);
  const cls = m?.[1]?.toLowerCase() ?? '';
  const value = num(tag(fragment, name));
  let direction: 'up' | 'down' | 'flat' = 'flat';
  if (cls.includes('dwn') || cls.includes('down') || cls.includes('red')) direction = 'down';
  else if (cls.includes('up') || cls.includes('green')) direction = 'up';
  else if (value !== null && value > 0) direction = 'up';
  else if (value !== null && value < 0) direction = 'down';
  return { value, direction };
}

/**
 * Every index on the page, deduplicated by symbol (the carousel markup can repeat a block for
 * the slider). Later duplicates do not overwrite earlier ones — the first is the plain one.
 */
export function parseIndices(html: string): ParsedIndex[] {
  const bySymbol = new Map<string, ParsedIndex>();
  for (const m of html.matchAll(/item indices-single/gi)) {
    const segment = html.slice(m.index!, m.index! + 700);
    const rawSymbol = tag(segment, 'h3');
    const level = num(tag(segment, 'h4'));
    // No symbol or no level: this is not one of the index blocks. Skipped, never guessed.
    if (!rawSymbol || level === null) continue;
    const symbol = rawSymbol.toUpperCase().replace(/\s+/g, '');
    if (bySymbol.has(symbol)) continue;
    const change = signed(segment, 'h5');
    const percent = signed(segment, 'h6');
    bySymbol.set(symbol, {
      symbol,
      level,
      change: change.value,
      changePercent: percent.value,
      direction: change.direction !== 'flat' ? change.direction : percent.direction,
    });
  }
  return [...bySymbol.values()];
}

/**
 * Sarmaaya's whole index board — the fallback when the exchange's own page cannot be read.
 *
 * Why a fallback at all: this read is the *only* writer of a session's index row, so a page that
 * refuses us does not leave the row empty, it freezes it. Measured on 2026-09-28: all 17 rows held
 * an 11:29 PKT reading while the session had closed, and the dashboard served KSE-100 as
 * 170,300.62 against a published close of 170,425.62. One unreachable page must not be able to
 * leave the board presenting an intraday level as a close.
 *
 * The series is the same one behind our stored history — Sarmaaya's `price-history` endpoint
 * reproduced the stored 24 Sep row for all 17 indices to the paisa (170498.95 against our
 * 170498.94) and 23 Sep exactly — so this is a fallback, not a second opinion. `change` and
 * `changePercent` are taken as published; when the source reports none the field stays null rather
 * than being recomputed into a number we would then have to defend.
 *
 * Endpoint: https://beta-restapi.sarmaaya.pk/api/indices
 * Response: { success, response: { data: [{ symbol, curr, change, changePercent, … }, …] } }
 */
export const SARMAYA_BOARD_URL = 'https://beta-restapi.sarmaaya.pk/api/indices';

const SARMAYA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/** A number from a value that may be a number, a numeric string, or absent. Null when unreadable. */
function numeric(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return num(typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : null);
}

/**
 * The board payload, in the same shape the exchange's page is parsed into.
 *
 * A row with no level is skipped rather than zeroed: `Number(null)` is 0, and a level of zero would
 * be stored as a close. A symbol the payload repeats is taken once, as with the carousel.
 */
export function parseSarmaayaIndices(payload: unknown): ParsedIndex[] {
  const data = (payload as { response?: { data?: unknown } } | null)?.response?.data;
  if (!Array.isArray(data)) return [];
  const bySymbol = new Map<string, ParsedIndex>();
  for (const raw of data as Record<string, unknown>[]) {
    const rawSymbol = typeof raw?.symbol === 'string' ? raw.symbol : null;
    const level = numeric(raw?.curr);
    if (!rawSymbol || level === null) continue;
    const symbol = rawSymbol.toUpperCase().replace(/\s+/g, '');
    if (bySymbol.has(symbol)) continue;
    const change = numeric(raw.change);
    const changePercent = numeric(raw.changePercent);
    bySymbol.set(symbol, {
      symbol,
      level,
      change,
      changePercent,
      direction: change !== null && change > 0 ? 'up' : change !== null && change < 0 ? 'down' : 'flat',
      // This endpoint publishes no timestamp — measured 2026-09-30, there is no `updated_at` key on
      // its rows (market-view has one). Null, not "now": the source cannot say when it read.
      readAt: null,
      volume: numeric(raw.volume),
    });
  }
  return [...bySymbol.values()];
}

/** Fetch and parse Sarmaaya's board. Throws when it cannot be read at all. */
export async function fetchSarmaayaIndices(timeoutMs = 15000): Promise<ParsedIndex[]> {
  let res: Response;
  try {
    res = await fetch(SARMAYA_BOARD_URL, {
      headers: { 'User-Agent': SARMAYA_UA, Accept: 'application/json', Referer: 'https://sarmaaya.pk/' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SiteUnavailableError(`sarmaaya indices unreachable: ${(e as Error).message.slice(0, 80)}`);
  }
  if (!res.ok) throw new SiteUnavailableError(`sarmaaya indices http ${res.status}`);
  const indices = parseSarmaayaIndices(await res.json());
  // An answer with no index rows is a parse failure, not an empty market.
  if (indices.length === 0) throw new SiteUnavailableError('sarmaaya indices carried no index rows');
  return indices;
}

/**
 * Sarmaaya's live index board — the endpoint the `/indexes` page itself renders.
 *
 * This leads the chain because it is the only source that says *when* it read: every row carries
 * `updated_at`, so a reading can prove it is live. The exchange's carousel carries no timestamp at
 * all, which is what let a board frozen at 11:29 PKT serve 170,300.62 as KSE-100's close at 15:17
 * PKT on 2026-09-28 without anything being able to tell that apart from a quiet market (#107).
 *
 * Endpoint: https://beta-restapi.sarmaaya.pk/api/dashboard/market-view
 * Response: { success, message, response: [{ symbol, name, close, change, changePercentage,
 *                                             volume, value, updated_at, history }, …] }
 *
 * `close` is the level and `value` is not: the same row carries `value` as a rupee amount
 * (KSE-100: 11,230,807,201.72 beside a close of 169,969.3266). Only `close` is read.
 */
export const SARMAYA_MARKET_VIEW_URL = 'https://beta-restapi.sarmaaya.pk/api/dashboard/market-view';

/** A timestamp the source published, or null when it is missing or unparseable. */
function readAt(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseSarmaayaMarketView(payload: unknown): ParsedIndex[] {
  const response = (payload as { response?: unknown } | null)?.response;
  // Measured 2026-09-30: this endpoint answers with `response` as the array itself, while its
  // sibling `/api/indices` nests its rows one level deeper at `response.data`. Both are read, so an
  // upstream shape change is a fallback rather than an empty board.
  const data = Array.isArray(response)
    ? response
    : (response as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  const bySymbol = new Map<string, ParsedIndex>();
  for (const raw of data as Record<string, unknown>[]) {
    const rawSymbol = typeof raw?.symbol === 'string' ? raw.symbol : null;
    const level = numeric(raw?.close);
    if (!rawSymbol || level === null) continue;
    const symbol = rawSymbol.toUpperCase().replace(/\s+/g, '');
    if (bySymbol.has(symbol)) continue;
    const change = numeric(raw.change);
    const changePercent = numeric(raw.changePercentage);
    bySymbol.set(symbol, {
      symbol,
      level,
      change,
      changePercent,
      direction: change !== null && change > 0 ? 'up' : change !== null && change < 0 ? 'down' : 'flat',
      readAt: readAt(raw.updated_at),
      volume: numeric(raw.volume),
    });
  }
  return [...bySymbol.values()];
}

/** Fetch and parse Sarmaaya's live board. Throws when it cannot be read at all. */
export async function fetchSarmaayaMarketView(timeoutMs = 15000): Promise<ParsedIndex[]> {
  let res: Response;
  try {
    res = await fetch(SARMAYA_MARKET_VIEW_URL, {
      headers: { 'User-Agent': SARMAYA_UA, Accept: 'application/json', Referer: 'https://sarmaaya.pk/' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SiteUnavailableError(`sarmaaya market-view unreachable: ${(e as Error).message.slice(0, 80)}`);
  }
  if (!res.ok) throw new SiteUnavailableError(`sarmaaya market-view http ${res.status}`);
  const indices = parseSarmaayaMarketView(await res.json());
  if (indices.length === 0) throw new SiteUnavailableError('sarmaaya market-view carried no index rows');
  return indices;
}

/**
 * The pass says what it read, how much of it, and when the source says it was read — so a log alone
 * can show a board that is live rather than merely answering.
 */
export function logLead(source: string, rows: ParsedIndex[]): void {
  const log = childLogger({ op: 'psx-indices' });
  const stamped = rows.filter((r) => r.readAt);
  log.info('psx-indices.lead', {
    source,
    count: rows.length,
    readAt: stamped[0]?.readAt?.toISOString() ?? null,
    stamped: stamped.length,
    withVolume: rows.filter((r) => r.volume != null).length,
  });
}

/** The exchange's own market-summary carousel. Throws when the page cannot be read at all. */
async function fetchPsxBoard(timeoutMs: number): Promise<ParsedIndex[]> {
  const log = childLogger({ op: 'psx-indices' });
  let res: Response;
  try {
    res = await fetch(PAGE, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SiteUnavailableError(`psx market-summary unreachable: ${(e as Error).message.slice(0, 80)}`);
  }
  if (!res.ok) throw new SiteUnavailableError(`psx market-summary http ${res.status}`);
  const html = await res.text();
  const indices = parseIndices(html);
  // A page that answers but yields nothing is a parse failure, not an empty market.
  if (indices.length === 0) throw new SiteUnavailableError('psx market-summary carried no index blocks');
  log.info('psx-indices.parsed', { count: indices.length, symbols: indices.map((i) => i.symbol) });
  return indices;
}

/**
 * Fetch and parse the board, in order of what each source can prove:
 *
 *   1. Sarmaaya's market-view — the `/indexes` page's own endpoint. All 18 indices, `close` as the
 *      level, and the only source that stamps each reading, so a stale board is detectable (#107).
 *   2. Sarmaaya's `/api/indices` — same host, 10 indices, no timestamp, but it carries volume.
 *   3. The exchange's market-summary carousel — the exchange's own page, which cannot say when it
 *      read, and is why a frozen board used to look exactly like a quiet one.
 *
 * Each leg is tried only when the one before it fails, and the *first* leg's error is what surfaces
 * when all of them do: a fallback must not hide the original failure behind its own reason.
 */
export async function fetchPsxIndices(timeoutMs = 20000): Promise<ParsedIndex[]> {
  const log = childLogger({ op: 'psx-indices' });
  const legs: Array<{ source: string; read: () => Promise<ParsedIndex[]> }> = [
    { source: 'sarmaaya market-view', read: () => fetchSarmaayaMarketView(timeoutMs) },
    { source: 'sarmaaya indices', read: () => fetchSarmaayaIndices(timeoutMs) },
    { source: 'psx market-summary', read: () => fetchPsxBoard(timeoutMs) },
  ];

  let firstError: unknown = null;
  for (const leg of legs) {
    try {
      const rows = await leg.read();
      if (leg !== legs[0]) {
        log.warn('psx-indices.fallback', {
          source: leg.source,
          reason: (firstError as Error | null)?.message?.slice(0, 120) ?? null,
          count: rows.length,
        });
      }
      logLead(leg.source, rows);
      return rows;
    } catch (e) {
      if (firstError === null) firstError = e;
    }
  }
  throw firstError instanceof Error ? firstError : new SiteUnavailableError('no index source answered');
}

/**
 * Human names for index symbols, from TradingView's public scanner (best effort).
 *
 * The PSX page publishes symbols only ("KSE100"), and TradingView's universe carries the
 * descriptions ("KSE 100 Index"). Purely cosmetic, so a failure returns an empty map and the
 * caller keeps the symbol as the name rather than inventing one.
 */
export async function fetchIndexNames(symbols: string[], timeoutMs = 15000): Promise<Record<string, string>> {
  if (symbols.length === 0) return {};
  try {
    const res = await fetch('https://scanner.tradingview.com/pakistan/scan', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        symbols: { tickers: symbols.map((s) => `PSX:${s}`), query: { types: [] } },
        columns: ['description'],
      }),
    });
    if (!res.ok) return {};
    const payload = (await res.json()) as { data?: Array<{ s: string; d: unknown[] }> };
    const names: Record<string, string> = {};
    for (const row of payload.data ?? []) {
      const symbol = row.s?.split(':')[1]?.toUpperCase();
      const description = row.d?.[0];
      if (symbol && typeof description === 'string' && description.trim()) names[symbol] = description.trim();
    }
    return names;
  } catch {
    return {};
  }
}
