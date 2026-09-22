import { env } from '../config';
import { childLogger } from '../utils/logger';
import { sourceBreaker } from '../utils/sourceBreaker';
import { SCRAPER_USER_AGENT } from '../utils/userAgent';
import { NavigationTimeoutError, ParseError, SiteUnavailableError } from '../types/errors';
import { sessionStamp, toIsoDate } from './parse.utils';
import type { QuoteSnapshot } from './psxQuotes.scraper';

/**
 * Market-wide quotes over plain HTTP — the poll's fallback when DPS refuses us.
 *
 * Endpoint: https://beta-restapi.sarmaaya.pk/api/stocks/ticker?index=ALLSHR
 * Response: { response: [{ symbol, price, change, changePercentage, volume, date }, ...] }
 *
 * Why this exists: the poll's primary source reads dps.psx.com.pk, which refuses this host
 * (issue #27). While it was down every symbol kept whatever the last full sync wrote — on
 * 2026-09-22 ABL served 171.19 (the 11:00 PKT reading) against a close of 170.05, so the
 * change and change% the API published were wrong for the whole market, in one direction,
 * all day. A refused source is not a reason to publish a stale price.
 *
 * This endpoint is the same one the daily board pass already reads, and it answers: measured
 * from the worker container, the whole market (~485 rows) in ~0.5s / ~120KB — cheaper than a
 * single symbol from DPS, so a fallback tick costs one request rather than one per symbol.
 *
 * What it carries and what it does not: price, change, change%, volume and the session date.
 * It carries no `open` and no previous close, so `open` is left null (the writer leaves a
 * stored one alone rather than blanking it) and change / change% are taken from the source
 * as-is instead of being recomputed from a previous close we would have to invent.
 */
export const SARMAYA_TICKER_URL = 'https://beta-restapi.sarmaaya.pk/api/stocks/ticker?index=ALLSHR';
export const SARMAYA_TICKER_SOURCE = 'sarmaaya-ticker';

/**
 * Tolerant number read for a JSON body: keeps a real `0` (a flat close, a zero-volume
 * session) and drops everything that is not a finite number — never coerces blanks to 0.
 */
function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const text = raw.trim().replace(/,/g, '');
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/**
 * Map the ticker payload to snapshots. Pure — the network lives in `fetchSarmaayaTicker`.
 *
 * Rows are dropped, never guessed at: no symbol, no positive price, or no session date we can
 * stamp means the row cannot be a quote and is left out. `date` comes back as midnight-UTC of
 * the trading day, which is NOT the row key the rest of the repo writes — `sessionStamp`
 * normalises it to the 16:00 PKT marker so a ticker row lands on the same session row DPS and
 * the company page write, instead of creating a second row for the same session.
 */
export function parseTicker(payload: unknown, symbols?: string[]): QuoteSnapshot[] {
  const rows = (payload as { response?: unknown } | null)?.response;
  if (!Array.isArray(rows)) throw new ParseError(SARMAYA_TICKER_SOURCE, 'response');

  const wanted = symbols ? new Set(symbols.map((s) => s.toUpperCase())) : null;
  const snapshots: QuoteSnapshot[] = [];

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;

    const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
    if (!symbol) continue;
    if (wanted && !wanted.has(symbol)) continue;

    const price = asNumber(row.price);
    if (price === null || price <= 0) continue;

    const stamp = sessionStamp(toIsoDate(typeof row.date === 'string' ? row.date : null));
    if (!stamp) continue;

    const volume = asNumber(row.volume);
    const change = asNumber(row.change);
    const changePercent = asNumber(row.changePercentage ?? row.changePercent);

    snapshots.push({
      symbol,
      sessionDate: new Date(stamp),
      price,
      open: null,
      volume: volume !== null && volume >= 0 ? volume : null,
      previousClose: null,
      change,
      changePercent,
    });
  }

  return snapshots;
}

/**
 * Fetch and map the market-wide ticker. Never retries: one request either answers or does not,
 * and a tick that misses is redone in a minute.
 */
export async function fetchSarmaayaTicker(symbols?: string[]): Promise<QuoteSnapshot[]> {
  const log = childLogger({ op: 'quote-poll', source: SARMAYA_TICKER_SOURCE });
  // Same discipline as the primary: do not ask a source that is already refusing us.
  sourceBreaker.assertAvailable(SARMAYA_TICKER_SOURCE);

  let resp: Response;
  try {
    resp = await fetch(SARMAYA_TICKER_URL, {
      headers: { accept: 'application/json', 'user-agent': SCRAPER_USER_AGENT },
      signal: AbortSignal.timeout(env.QUOTE_POLL_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = /abort|timeout/i.test(message)
      ? new NavigationTimeoutError(SARMAYA_TICKER_SOURCE, { url: SARMAYA_TICKER_URL })
      : new SiteUnavailableError(SARMAYA_TICKER_SOURCE, { message });
    sourceBreaker.recordFailure(SARMAYA_TICKER_SOURCE, error.message);
    throw error;
  }

  if (!resp.ok) {
    const error = new SiteUnavailableError(SARMAYA_TICKER_SOURCE, { status: resp.status });
    sourceBreaker.recordFailure(SARMAYA_TICKER_SOURCE, error.message);
    throw error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await resp.text()) as unknown;
  } catch {
    throw new ParseError(SARMAYA_TICKER_SOURCE, 'json-body');
  }

  const snapshots = parseTicker(payload, symbols);
  sourceBreaker.recordSuccess(SARMAYA_TICKER_SOURCE);
  log.info('sarmaaya-ticker.parsed', { rows: snapshots.length, filtered: symbols?.length ?? null });
  return snapshots;
}
