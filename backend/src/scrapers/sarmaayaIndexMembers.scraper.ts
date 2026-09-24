import { env } from '../config';
import { childLogger } from '../utils/logger';
import { recordSourceFailure, sourceBreaker } from '../utils/sourceBreaker';
import { NavigationTimeoutError, ParseError, SiteUnavailableError } from '../types/errors';

/**
 * A published index's member list, from Sarmaaya's public ticker API.
 *
 * Endpoint: GET https://beta-restapi.sarmaaya.pk/api/stocks/ticker?index=<SYMBOL>
 * Response: { success, message, response: [{ symbol, volume, isShariah, changePercentage,
 *             change, price, date }, ...] }
 *
 * Why this exists: the dashboard lists ~508 tracked symbols and its first page is the KSE-100
 * member set, kept by the scstrade pass. PSX publishes 17 indices, and every one of them has a
 * real member list upstream — this endpoint answers for all of them (`?index=KMI30`, `?index=OGTI`,
 * `?index=ALLSHR` …), so the second index's membership is a parameter rather than a second scraper.
 * Measured 2026-09-24: KMI30 30 rows / 4 KB, OGTI 3 rows / 0.5 KB, ALLSHR 485 rows / 66 KB, one
 * request each.
 *
 * What it carries and what it does not: the *symbols* are the payload's point. It carries a quote
 * per member (price, volume, change) but **no company name**, so `name` is stored as null here —
 * never derived from the symbol and never borrowed from another source, because a name we invented
 * is indistinguishable from one the exchange published. KSE100 keeps the exchange's own member
 * site instead, precisely because it does print names (see `indexMembership.service`).
 */
export const SARMAYA_INDEX_MEMBERS_SOURCE = 'sarmaaya-index-members';

export const SARMAYA_INDEX_MEMBERS_BASE = 'https://beta-restapi.sarmaaya.pk/api/stocks/ticker';

/**
 * The member list URL for one index symbol.
 *
 * Exported so the caller that decides *which* index to ask for and the request that goes out are
 * the same value — an index whose poll silently asked for another index's list would be invisible
 * in the response.
 */
export function indexMembersUrl(indexSymbol: string): string {
  return `${SARMAYA_INDEX_MEMBERS_BASE}?index=${encodeURIComponent(indexSymbol.trim().toUpperCase())}`;
}

/**
 * A browser-shaped agent. This host distinguishes the two channels: a plain `curl` with no
 * User-Agent is answered `http=000` on PSX's own data paths, and this API answers a browser agent
 * reliably, so the JSON endpoints are asked with one (the same one the ticket measurement used).
 */
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * The same constituent shape the scstrade source returns, so the membership pass treats the two
 * sources interchangeably: only `symbol` is guaranteed, `name` is null when the source is silent.
 */
export interface IndexConstituent {
  symbol: string;
  name: string | null;
}

/**
 * Map the ticker payload to constituents. Pure — the network lives in `fetchIndexMembers`.
 *
 * A payload that is not this shape is *refused*, not reported as an empty index: this list feeds a
 * replace, so a parser that quietly returned [] would wipe the index's whole member set while
 * logging a successful pass. `success: false` (an unknown or unpublished index) is refused for the
 * same reason.
 *
 * Rows are dropped, never guessed at: a row without a symbol is not a constituent. Symbols are
 * upper-cased and de-duplicated, keeping the first occurrence — the source's own order is the
 * position the membership pass stores.
 *
 * An empty `response` comes back as an empty list, because that *is* what the source said. It
 * answers `{success: true, response: []}` for a symbol it has no list for (measured against
 * `?index=NOPE`), so a caller that writes this list decides what an empty answer means — the
 * membership pass refuses to replace a member set with it (`indexMembership.service`).
 */
export function parseIndexMembers(payload: unknown): IndexConstituent[] {
  const body = payload as { success?: unknown; response?: unknown } | null;
  if (body?.success !== true) throw new ParseError(SARMAYA_INDEX_MEMBERS_SOURCE, 'success');

  const rows = body.response;
  if (!Array.isArray(rows)) throw new ParseError(SARMAYA_INDEX_MEMBERS_SOURCE, 'response');

  const seen = new Set<string>();
  const constituents: IndexConstituent[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const field = (raw as Record<string, unknown>).symbol;
    const symbol = typeof field === 'string' ? field.trim().toUpperCase() : '';
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    constituents.push({ symbol, name: null });
  }
  return constituents;
}

/**
 * Fetch one index's member list. Never retries: a missed pass leaves yesterday's membership in
 * place, which is a schedule later rather than a wrong answer now.
 *
 * Only a refusal or a timeout counts against the source's breaker — an unknown index answers
 * `success: false`, which is a wrong symbol and must not start a cooldown (a cooldown would then
 * hide the real cause behind a 5-minute silence).
 */
export async function fetchIndexMembers(indexSymbol: string): Promise<IndexConstituent[]> {
  const symbol = indexSymbol.trim().toUpperCase();
  const url = indexMembersUrl(symbol);
  const log = childLogger({ op: 'index-membership', source: SARMAYA_INDEX_MEMBERS_SOURCE, index: symbol });
  sourceBreaker.assertAvailable(SARMAYA_INDEX_MEMBERS_SOURCE);

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(env.SCRAPER_TIMEOUT),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = /abort|timeout/i.test(message)
      ? new NavigationTimeoutError(SARMAYA_INDEX_MEMBERS_SOURCE, { url })
      : new SiteUnavailableError(SARMAYA_INDEX_MEMBERS_SOURCE, { message });
    recordSourceFailure(SARMAYA_INDEX_MEMBERS_SOURCE, error);
    throw error;
  }

  if (!resp.ok) {
    const error = new SiteUnavailableError(SARMAYA_INDEX_MEMBERS_SOURCE, { status: resp.status, index: symbol });
    recordSourceFailure(SARMAYA_INDEX_MEMBERS_SOURCE, error);
    throw error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await resp.text()) as unknown;
  } catch {
    throw new ParseError(SARMAYA_INDEX_MEMBERS_SOURCE, 'json-body');
  }

  const constituents = parseIndexMembers(payload);
  sourceBreaker.recordSuccess(SARMAYA_INDEX_MEMBERS_SOURCE);
  log.info('index-membership.parsed', { rows: constituents.length });
  return constituents;
}
