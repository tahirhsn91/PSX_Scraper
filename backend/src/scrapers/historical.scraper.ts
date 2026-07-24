import { browserPool } from './browserPool';
import { childLogger } from '../utils/logger';
import { InvalidSymbolError, NavigationTimeoutError, ParseError, SiteUnavailableError } from '../types/errors';

export interface HistoricalPoint {
  date: string; // ISO
  close: number;
  open: number | null;
  volume: number | null;
}

/**
 * Historical EOD time-series from PSX DPS.
 * Endpoint: https://dps.psx.com.pk/timeseries/eod/{SYMBOL}
 * Response: { status, message, data: [[epochSeconds, close, volume, open], ...] } (newest first)
 */
export class PSXHistoricalScraper {
  readonly source = 'psx-eod';
  private readonly baseUrl = 'https://dps.psx.com.pk/timeseries/eod';

  async fetchEod(symbol: string): Promise<HistoricalPoint[]> {
    const sym = symbol.toUpperCase();
    const log = childLogger({ symbol: sym, op: 'history-scrape' });
    const url = `${this.baseUrl}/${sym}`;

    return browserPool.withPage(async (page) => {
      let body: unknown;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (resp && resp.status() === 404) throw new InvalidSymbolError(sym);
        if (resp && resp.status() >= 500) throw new SiteUnavailableError(this.source);
        // The endpoint returns JSON; read the raw text and parse.
        const text = await page.evaluate(() => document.body.innerText);
        body = JSON.parse(text);
      } catch (err) {
        if (err instanceof InvalidSymbolError || err instanceof SiteUnavailableError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('timeout')) throw new NavigationTimeoutError(this.source, { url });
        if (err instanceof SyntaxError) throw new ParseError(this.source, 'json-body');
        throw new SiteUnavailableError(this.source, { message: msg });
      }

      const rows = (body as { data?: unknown }).data;
      if (!Array.isArray(rows)) throw new ParseError(this.source, 'data-array');

      const points: HistoricalPoint[] = [];
      for (const row of rows as unknown[]) {
        if (!Array.isArray(row) || row.length < 2) continue;
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
    });
  }
}

export const psxHistoricalScraper = new PSXHistoricalScraper();
