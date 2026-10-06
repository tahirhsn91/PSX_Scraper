import { prisma } from '../database/prisma';
import { fetchIndexConstituents } from '../scrapers/sarmaayaIndexCompanies.scraper';
import { updateStockLogos } from '../repositories/stock.repository';
import { logger } from '../utils/logger';

export interface StockLogoRefreshSummary {
  /** Tracked symbols we attempted to cover. */
  tracked: number;
  /** Tracked symbols the All-Share board returned a row for. */
  fetched: number;
  /** Logos actually written (non-null URL rows). */
  written: number;
  /** Tracked symbols the board published no logo for — the frontend's letter-avatar fallback. */
  missing: string[];
  durationMs: number;
}

/**
 * Refresh the company logo on every tracked stock.
 *
 * The source is the All-Share index's constituents board (`/api/indices/ALLSHR/companies`) — the
 * one reachable endpoint that carries a `logo` URL per security, and the same board the index
 * contribution pass already walks. Five requests cover the whole board (~1,270 rows), which is why
 * this rides its own slow schedule rather than the poll's minute tick: a logo changes with a
 * rebrand, not with the price.
 *
 * Only non-null URLs are written. A symbol the board publishes no logo for (ETFs, preference
 * shares, rights, delisted names) keeps whatever it had — never blanked — and is reported in
 * `missing` so the fallback stays honest instead of being hidden.
 */
export const stockLogoService = {
  async refresh(): Promise<StockLogoRefreshSummary> {
    const started = Date.now();

    const constituents = await fetchIndexConstituents('ALLSHR');
    const logoBySymbol = new Map<string, string>();
    for (const row of constituents) {
      if (row.logo) logoBySymbol.set(row.symbol, row.logo);
    }

    const tracked = await prisma.stock.findMany({ select: { symbol: true } });
    const symbols: string[] = [];
    const urls: string[] = [];
    const missing: string[] = [];
    for (const { symbol } of tracked) {
      const logo = logoBySymbol.get(symbol);
      if (logo) {
        symbols.push(symbol);
        urls.push(logo);
      } else {
        missing.push(symbol);
      }
    }

    const written = await updateStockLogos(symbols, urls);

    const summary: StockLogoRefreshSummary = {
      tracked: tracked.length,
      fetched: symbols.length,
      written,
      missing,
      durationMs: Date.now() - started,
    };
    logger.info('stocklogo.refresh_done', {
      tracked: summary.tracked,
      fetched: summary.fetched,
      written,
      missing: missing.length,
      durationMs: summary.durationMs,
    });
    return summary;
  },
};
