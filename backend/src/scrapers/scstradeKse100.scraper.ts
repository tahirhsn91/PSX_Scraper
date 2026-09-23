import { env } from '../config';
import { childLogger } from '../utils/logger';
import { sourceBreaker } from '../utils/sourceBreaker';
import { SCRAPER_USER_AGENT } from '../utils/userAgent';
import { ParseError, SiteUnavailableError } from '../types/errors';

/**
 * The KSE-100 constituent list, from the exchange's own member site (scstrade.com).
 *
 * Page: https://www.scstrade.com/MarketStatistics/MS_MarketValuations.aspx?sectorid=-1&name=KSE%20100%20Index
 * Data: POST https://www.scstrade.com/MarketStatistics/MS_MarketValuations.aspx/resdata
 *       body {"id":"-1"} → { d: '{"dt":[{"Symbol":"ABL","Name":"Allied Bank Ltd.","Price":170.06,…}]}' }
 *
 * Why this exists: the dashboard lists ~508 tracked symbols, and the ones a reader opens first are
 * the index's constituents. The page is an ASP.NET page method — no browser, no ViewState round
 * trip, one request, ~0.6s for the whole list — so keeping the membership current costs a request
 * per pass rather than a Chromium session.
 *
 * What it is and is not: the *membership* is the payload's point. It also carries per-company
 * valuation columns (EPS, P/E, price-to-book, ROE, ROA, dividend yield), which are deliberately
 * not parsed here — this scraper answers "which companies are in the index", and a field nobody
 * persists is a field nobody checks.
 *
 * Coverage, measured 2026-09-23: the page returns 99 rows while the index's own ticker list
 * carries 100 — the difference is HGFA, which this page omits (it prints no price for it). The
 * list is therefore taken as the source states it, and the count is data, never a constant.
 */
export const SCSTRADE_KSE100_SOURCE = 'scstrade-kse100';

export const SCSTRADE_KSE100_URL =
  'https://www.scstrade.com/MarketStatistics/MS_MarketValuations.aspx/resdata';

/** The sector id the page sends for the KSE-100 view (`var comp = '-1'` in its own script). */
export const KSE100_SECTOR_ID = '-1';

export interface IndexConstituent {
  symbol: string;
  name: string | null;
}

/**
 * Tolerant text read: trims the trailing padding the source prints in `Name`
 * ("Abbott Laboratories (Pak) Ltd.       ") and treats a blank as absent.
 */
function asText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text ? text : null;
}

/**
 * Map the page method's payload to constituents. Pure — the network lives in `fetchKse100`.
 *
 * The response is double-encoded (`{d: "<json string>"}`), which is ASP.NET's shape and not a
 * quirk of this call, so it is unwrapped here and the test pins both layers. A row without a
 * symbol is dropped rather than guessed: every other field can be absent, the symbol cannot.
 */
export function parseKse100(payload: unknown): IndexConstituent[] {
  const wrapped = payload as { d?: unknown } | null;
  let inner: unknown = wrapped?.d ?? payload;
  if (typeof inner === 'string') {
    try {
      inner = JSON.parse(inner) as unknown;
    } catch {
      throw new ParseError(SCSTRADE_KSE100_SOURCE, 'd');
    }
  }

  const rows = (inner as { dt?: unknown } | null)?.dt;
  if (!Array.isArray(rows)) throw new ParseError(SCSTRADE_KSE100_SOURCE, 'dt');

  const seen = new Set<string>();
  const constituents: IndexConstituent[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const symbol = (asText(row.Symbol) ?? '').toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    constituents.push({ symbol, name: asText(row.Name) });
  }
  return constituents;
}

/**
 * Fetch the constituent list. Never retries: a missed pass leaves yesterday's membership in place,
 * which is a schedule later rather than a wrong answer now.
 */
export async function fetchKse100(): Promise<IndexConstituent[]> {
  const log = childLogger({ op: 'kse100-membership', source: SCSTRADE_KSE100_SOURCE });
  sourceBreaker.assertAvailable(SCSTRADE_KSE100_SOURCE);

  let resp: Response;
  try {
    resp = await fetch(SCSTRADE_KSE100_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/json; charset=utf-8',
        'x-requested-with': 'XMLHttpRequest',
        // The page posts from its own origin; sending the referer keeps this the same call.
        referer:
          'https://www.scstrade.com/MarketStatistics/MS_MarketValuations.aspx?sectorid=-1&name=KSE%20100%20Index',
        'user-agent': SCRAPER_USER_AGENT,
      },
      body: JSON.stringify({ id: KSE100_SECTOR_ID }),
      signal: AbortSignal.timeout(env.SCRAPER_TIMEOUT),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = new SiteUnavailableError(SCSTRADE_KSE100_SOURCE, { message });
    sourceBreaker.recordFailure(SCSTRADE_KSE100_SOURCE, error.message);
    throw error;
  }

  if (!resp.ok) {
    const error = new SiteUnavailableError(SCSTRADE_KSE100_SOURCE, { status: resp.status });
    sourceBreaker.recordFailure(SCSTRADE_KSE100_SOURCE, error.message);
    throw error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await resp.text()) as unknown;
  } catch {
    throw new ParseError(SCSTRADE_KSE100_SOURCE, 'json-body');
  }

  const constituents = parseKse100(payload);
  sourceBreaker.recordSuccess(SCSTRADE_KSE100_SOURCE);
  log.info('kse100-membership.parsed', { rows: constituents.length });
  return constituents;
}
