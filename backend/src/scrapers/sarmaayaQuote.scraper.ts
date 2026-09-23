import { env } from '../config';
import { childLogger } from '../utils/logger';
import { sourceBreaker } from '../utils/sourceBreaker';
import { SCRAPER_USER_AGENT } from '../utils/userAgent';
import { NavigationTimeoutError, ParseError, SiteUnavailableError } from '../types/errors';
import { sessionStamp, toIsoDate } from './parse.utils';
import type { QuoteSnapshot } from './psxQuotes.scraper';

/**
 * Per-symbol quotes over plain HTTP — the poll's third source, for what the market-wide ticker
 * cannot serve.
 *
 * Endpoint: https://beta-restapi.sarmaaya.pk/api/stocks/{SYMBOL}
 * Response: { success, response: { symbol, close, high, low, volume, change,
 *            change_percentage, high52, low52, sectorName, date, … } }
 *
 * Why this exists: the ticker's list covers the board but not *everything* we track — measured
 * 2026-09-23 it carried 471–485 rows while we track 508. The difference is the ETFs, the
 * preference shares and the renamed tickers (ENGRO → ENGROH), and those symbols kept the
 * browser pass's reading from up to half an hour earlier while the rest of the market ticked.
 * This endpoint answers for every one of them (ACIETF, AGLNCPS, ENGROH all 200) in ~0.7s with
 * no browser, so covering them costs one request each rather than a Chromium pass.
 *
 * It is deliberately *not* the bulk path: 508 requests a minute would be the behaviour that got
 * this host refused in the first place (#27). The ticker serves the board in one request and
 * this leg fills the remainder, capped by `SARMAYA_QUOTE_MAX_SYMBOLS`.
 *
 * It carries `close` (= the current price), the day range, volume, change and change%, and its
 * own quote timestamp — so the session key comes from the source, never the wall clock. It does
 * not state a previous close, so none is invented: `previousClose` stays null and change /
 * change% are taken as the source publishes them.
 */
export function sarmaayaQuoteUrl(symbol: string): string {
  return `https://beta-restapi.sarmaaya.pk/api/stocks/${encodeURIComponent(symbol.toUpperCase())}`;
}

export const SARMAYA_QUOTE_SOURCE = 'sarmaaya-quote';

export interface SarmaayaQuoteFetchResult {
  snapshots: QuoteSnapshot[];
  failures: Array<{ symbol: string; error: string }>;
}

/**
 * Tolerant number read for a JSON body: keeps a real `0` (a flat close, a zero-volume session)
 * and drops everything that is not a finite number — never coerces blanks to 0.
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
 * Map one symbol's payload to a snapshot, or `null` when it cannot be one.
 *
 * Pure on purpose — the network lives in `fetchSarmaayaQuotes`. A row is dropped rather than
 * guessed: no positive close, or no quote timestamp we can stamp a session from, means it is
 * not a quote. A 52-week pair whose endpoints are `0 / 0` (a delisted name prints that) is not
 * carried either.
 */
export function parseStockQuote(payload: unknown, expectedSymbol: string): QuoteSnapshot | null {
  const row = (payload as { response?: unknown } | null)?.response;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  const symbol =
    typeof r.symbol === 'string' && r.symbol.trim()
      ? r.symbol.trim().toUpperCase()
      : expectedSymbol.trim().toUpperCase();
  if (!symbol) return null;

  const price = asNumber(r.close ?? r.price);
  if (price === null || price <= 0) return null;

  const stamp = sessionStamp(toIsoDate(typeof r.date === 'string' ? r.date : null));
  if (!stamp) return null;

  const volume = asNumber(r.volume);
  const high = asNumber(r.high);
  const low = asNumber(r.low);

  return {
    symbol,
    sessionDate: new Date(stamp),
    price,
    open: null,
    volume: volume !== null && volume >= 0 ? volume : null,
    previousClose: null,
    change: asNumber(r.change),
    changePercent: asNumber(r.change_percentage ?? r.changePercentage),
    // Only real readings: a range endpoint of 0 is the source's placeholder, not a price.
    high: high !== null && high > 0 ? high : null,
    low: low !== null && low > 0 ? low : null,
  };
}

/**
 * Fetch a bounded set of symbols, one request each, paced across lanes.
 *
 * The cap is the safety rail: the market-wide ticker is the bulk path, so this leg is only ever
 * meant to cover the handful the ticker omits. If it is ever handed the whole board (the ticker
 * failed, or a caller bypassed it) the excess is refused and reported rather than fired — 500
 * requests a minute is how this host lost dps.psx.com.pk.
 */
export async function fetchSarmaayaQuotes(
  symbols: string[],
  options: { concurrency?: number; max?: number } = {},
): Promise<SarmaayaQuoteFetchResult> {
  const log = childLogger({ op: 'quote-poll', source: SARMAYA_QUOTE_SOURCE });
  const snapshots: QuoteSnapshot[] = [];
  const failures: Array<{ symbol: string; error: string }> = [];

  const cap = Math.max(0, options.max ?? env.SARMAYA_QUOTE_MAX_SYMBOLS);
  const wanted = symbols.map((s) => s.toUpperCase());
  const capped = wanted.slice(0, cap);
  const over = wanted.length - capped.length;
  if (over > 0) {
    log.warn('sarmaaya-quote.capped', { requested: wanted.length, cap, dropped: over });
  }
  if (capped.length === 0) return { snapshots, failures };

  // Same discipline as every other source: do not ask one that is already refusing us.
  sourceBreaker.assertAvailable(SARMAYA_QUOTE_SOURCE);

  const lanes = Math.max(1, Math.min(options.concurrency ?? env.QUOTE_POLL_CONCURRENCY, capped.length));
  let cursor = 0;

  const runLane = async (): Promise<void> => {
    while (cursor < capped.length) {
      const symbol = capped[cursor];
      cursor += 1;
      if (!symbol) continue;
      const url = sarmaayaQuoteUrl(symbol);
      try {
        const resp = await fetch(url, {
          headers: { accept: 'application/json', 'user-agent': SCRAPER_USER_AGENT },
          signal: AbortSignal.timeout(env.QUOTE_POLL_TIMEOUT_MS),
        });
        if (!resp.ok) {
          // A 404 here is a symbol the source does not carry — an answer, not an outage, so it
          // is reported per symbol and never trips the breaker.
          failures.push({ symbol, error: `http=${resp.status}` });
          continue;
        }
        const snapshot = parseStockQuote(JSON.parse(await resp.text()) as unknown, symbol);
        if (snapshot) snapshots.push(snapshot);
        else failures.push({ symbol, error: 'payload carried no usable quote' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ symbol, error: message });
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, () => runLane()));

  // Trip the breaker on a *transport* failure, not on an answer: a lane that reached the host
  // and was told "no such symbol" says nothing about availability.
  const transportFailures = failures.filter((f) => !f.error.startsWith('http='));
  if (transportFailures.length > 0 && snapshots.length === 0) {
    const error = new SiteUnavailableError(SARMAYA_QUOTE_SOURCE, {
      failed: transportFailures.length,
      first: transportFailures[0]?.error,
    });
    sourceBreaker.recordFailure(SARMAYA_QUOTE_SOURCE, error.message);
  } else if (snapshots.length > 0) {
    sourceBreaker.recordSuccess(SARMAYA_QUOTE_SOURCE);
  }

  log.info('sarmaaya-quote.parsed', {
    fetched: snapshots.length,
    failed: failures.length,
    capped: over || null,
  });
  return { snapshots, failures };
}

/** Errors this module can raise, re-exported for the caller's classifier. */
export { NavigationTimeoutError, ParseError, SiteUnavailableError };
