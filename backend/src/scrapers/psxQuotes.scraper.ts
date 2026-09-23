import { env } from '../config';
import { childLogger } from '../utils/logger';
import { sourceBreaker } from '../utils/sourceBreaker';
import { SCRAPER_USER_AGENT } from '../utils/userAgent';
import { InvalidSymbolError, NavigationTimeoutError, ParseError, SiteUnavailableError } from '../types/errors';

/**
 * Live quotes over plain HTTP — no Chromium.
 *
 * Endpoint: https://dps.psx.com.pk/timeseries/eod/{SYMBOL}
 * Response: { status, message, data: [[epochSeconds, close, volume, open], ...] } newest first
 *
 * The price field of a company page needs a browser and a DOM selector that drifts; this
 * endpoint needs neither and costs ~40KB per symbol, which is what makes a one-minute poll
 * affordable. Measured from the worker container: 12 symbols fetched in parallel = 1.3s.
 *
 * The newest row is the session in progress (its stamp is the session's close marker, e.g.
 * 11:00Z = 16:00 PKT) and the row after it is the previous session's close — which is all
 * change / change% need, so no second source is involved.
 */
export interface QuoteSnapshot {
  symbol: string;
  /** The session this reading belongs to — from the series stamp, never the wall clock. */
  sessionDate: Date;
  price: number;
  open: number | null;
  volume: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  /**
   * Day range, when the source states one. Optional and left undefined by the sources that do
   * not carry it (the DPS series, the market-wide ticker) so a stored reading survives rather
   * than being blanked — the same rule `open` follows.
   */
  high?: number | null;
  low?: number | null;
}

export interface QuoteFetchResult {
  snapshots: QuoteSnapshot[];
  failures: Array<{ symbol: string; error: string }>;
}

/** Round to the 4 decimal places the price columns store. */
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

/**
 * Newest-first series rows → the snapshot for the newest session, or `null` when the series
 * carries no usable reading. Values are never fabricated: a missing previous close yields a
 * null change rather than a zero.
 */
export function buildQuoteSnapshot(symbol: string, rows: unknown[][]): QuoteSnapshot | null {
  const usable = rows
    .filter((r) => Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number')
    .sort((a, b) => (b[0] as number) - (a[0] as number));

  const newest = usable[0];
  if (!newest) return null;

  const price = newest[1] as number;
  if (!Number.isFinite(price) || price <= 0) return null;

  const previous = usable[1];
  const previousClose =
    previous && typeof previous[1] === 'number' && previous[1] > 0 ? (previous[1] as number) : null;

  return {
    symbol: symbol.toUpperCase(),
    sessionDate: new Date((newest[0] as number) * 1000),
    price,
    open: typeof newest[3] === 'number' ? newest[3] : null,
    volume: typeof newest[2] === 'number' ? newest[2] : null,
    previousClose,
    change: previousClose === null ? null : round4(price - previousClose),
    changePercent:
      previousClose === null ? null : round4(((price - previousClose) / previousClose) * 100),
  };
}

export class PSXQuoteScraper {
  readonly source = 'psx-quotes';
  private readonly baseUrl = 'https://dps.psx.com.pk/timeseries/eod';

  /** Snapshot for one symbol, or `null` when the series has no usable row. */
  async fetchSnapshot(symbol: string): Promise<QuoteSnapshot | null> {
    const sym = symbol.toUpperCase();
    const body = await this.fetchJson(`${this.baseUrl}/${sym}`, sym);
    return buildQuoteSnapshot(sym, this.rowsOf(body));
  }

  /**
   * Snapshots for many symbols with bounded parallelism. Never rejects: a symbol that fails
   * (bad ticker, network, malformed body) lands in `failures` and the rest still come back.
   */
  async fetchMany(symbols: string[], concurrency = env.QUOTE_POLL_CONCURRENCY): Promise<QuoteFetchResult> {
    const log = childLogger({ op: 'quote-poll' });
    const snapshots: QuoteSnapshot[] = [];
    const failures: Array<{ symbol: string; error: string }> = [];
    const lanes = Math.max(1, Math.min(concurrency, symbols.length));
    let cursor = 0;

    const runLane = async (): Promise<void> => {
      while (cursor < symbols.length) {
        const symbol = symbols[cursor];
        cursor += 1;
        if (!symbol) continue;
        try {
          const snapshot = await this.fetchSnapshot(symbol);
          if (snapshot) snapshots.push(snapshot);
          else failures.push({ symbol, error: 'series carried no usable row' });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          failures.push({ symbol, error });
          log.warn('quote-poll.symbol_failed', { symbol, error });
        }
      }
    };

    await Promise.all(Array.from({ length: lanes }, runLane));
    return { snapshots, failures };
  }

  /** GET and parse a DPS JSON body over plain fetch — deliberately not the browser pool. */
  private async fetchJson(url: string, sym: string): Promise<unknown> {
    // Never ask a source that is already refusing us: the request would be dropped anyway, and
    // the volume is what earned the refusal (#27).
    sourceBreaker.assertAvailable(this.source);

    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': SCRAPER_USER_AGENT },
        signal: AbortSignal.timeout(env.QUOTE_POLL_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const error = /abort|timeout/i.test(msg)
        ? new NavigationTimeoutError(this.source, { url })
        : new SiteUnavailableError(this.source, { message: msg });
      sourceBreaker.recordFailure(this.source, error.message);
      throw error;
    }

    if (resp.status === 404) throw new InvalidSymbolError(sym);
    if (!resp.ok) {
      const error = new SiteUnavailableError(this.source, { status: resp.status });
      sourceBreaker.recordFailure(this.source, error.message);
      throw error;
    }

    try {
      const body = JSON.parse(await resp.text()) as unknown;
      sourceBreaker.recordSuccess(this.source);
      return body;
    } catch {
      throw new ParseError(this.source, 'json-body');
    }
  }

  /** `data` array of rows, or a ParseError. */
  private rowsOf(body: unknown): unknown[][] {
    const rows = (body as { data?: unknown }).data;
    if (!Array.isArray(rows)) throw new ParseError(this.source, 'data-array');
    return rows.filter((r): r is unknown[] => Array.isArray(r));
  }
}

export const psxQuoteScraper = new PSXQuoteScraper();
