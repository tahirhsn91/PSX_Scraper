import { browserPool } from './browserPool';
import { childLogger } from '../utils/logger';
import { InvalidSymbolError, NavigationTimeoutError, ParseError, SiteUnavailableError } from '../types/errors';

export interface HistoricalPoint {
  date: string; // ISO
  close: number;
  open: number | null;
  volume: number | null;
}

export interface IntradayPoint {
  date: string; // ISO
  value: number;
  volume: number | null;
}

/**
 * Historical EOD time-series from PSX DPS.
 * Endpoint: https://dps.psx.com.pk/timeseries/eod/{SYMBOL}
 * Response: { status, message, data: [[epochSeconds, close, volume, open], ...] } (newest first)
 *
 * The same endpoint serves market indices — `/timeseries/eod/KSE100` returns the
 * index series in exactly this shape — so indices reuse this method rather than
 * getting a scraper of their own (see services/indexSync.service.ts).
 */
export class PSXHistoricalScraper {
  readonly source = 'psx-eod';
  private readonly baseUrl = 'https://dps.psx.com.pk/timeseries/eod';

  async fetchEod(symbol: string): Promise<HistoricalPoint[]> {
    const sym = symbol.toUpperCase();
    const log = childLogger({ symbol: sym, op: 'history-scrape' });
    const url = `${this.baseUrl}/${sym}`;

    const body = await this.fetchJson(url, sym);
    const rows = this.rowsOf(body);

    const points: HistoricalPoint[] = [];
    for (const row of rows) {
      if (row.length < 2) continue;
      const ts = row[0];
      const close = row[1];
      const volume = row[2];
      const open = row[3];
      if (typeof ts !== 'number' || typeof close !== 'number') continue;
      points.push({
        date: new Date(ts * 1000).toISOString(),
        close,
        open: typeof open === 'number' ? open : null,
        volume: typeof volume === 'number' ? volume : null,
      });
    }
    log.info('history-scrape.done', { total: points.length });
    return points;
  }

  /**
   * Intraday series — the freshest reading available while a session is open.
   * Endpoint: https://dps.psx.com.pk/timeseries/int/{SYMBOL}
   * Response: { status, message, data: [[epochSeconds, value, volume], ...] } (newest first)
   */
  async fetchIntraday(symbol: string): Promise<IntradayPoint[]> {
    const sym = symbol.toUpperCase();
    const log = childLogger({ symbol: sym, op: 'intraday-scrape' });
    const url = `${this.baseUrl.replace('/eod', '/int')}/${sym}`;

    const body = await this.fetchJson(url, sym);
    const rows = this.rowsOf(body);

    const points: IntradayPoint[] = [];
    for (const row of rows) {
      if (row.length < 2) continue;
      const ts = row[0];
      const value = row[1];
      const volume = row[2];
      if (typeof ts !== 'number' || typeof value !== 'number') continue;
      points.push({
        date: new Date(ts * 1000).toISOString(),
        value,
        volume: typeof volume === 'number' ? volume : null,
      });
    }
    log.info('intraday-scrape.done', { total: points.length });
    return points;
  }

  /** GET a DPS time-series URL inside the browser and parse its JSON body. */
  private async fetchJson(url: string, sym: string): Promise<unknown> {
    return browserPool.withPage(async (page) => {
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (resp && resp.status() === 404) throw new InvalidSymbolError(sym);
        if (resp && resp.status() >= 500) throw new SiteUnavailableError(this.source);
        // The endpoint returns JSON; read the raw text and parse.
        const text = await page.evaluate(() => document.body.innerText);
        return JSON.parse(text) as unknown;
      } catch (err) {
        if (err instanceof InvalidSymbolError || err instanceof SiteUnavailableError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('timeout')) throw new NavigationTimeoutError(this.source, { url });
        if (err instanceof SyntaxError) throw new ParseError(this.source, 'json-body');
        throw new SiteUnavailableError(this.source, { message: msg });
      }
    });
  }

  /** `data` array of rows, or a ParseError. */
  private rowsOf(body: unknown): unknown[][] {
    const rows = (body as { data?: unknown }).data;
    if (!Array.isArray(rows)) throw new ParseError(this.source, 'data-array');
    return rows.filter((r): r is unknown[] => Array.isArray(r));
  }
}

export const psxHistoricalScraper = new PSXHistoricalScraper();
