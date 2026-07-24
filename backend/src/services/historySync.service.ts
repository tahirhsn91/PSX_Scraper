import { psxHistoricalScraper } from '../scrapers/historical.scraper';
import { bulkUpsertHistory } from '../repositories/history.repository';
import { stockRepository } from '../repositories/stock.repository';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { rangeToFrom, HistoryRange } from '../utils/range';
import { childLogger } from '../utils/logger';
import { NotFoundError } from '../types/errors';

export type ProgressFn = (percent: number, note?: string) => Promise<void> | void;

export interface HistorySyncSummary {
  symbol: string;
  range: HistoryRange;
  fetched: number;
  persisted: number;
  status: 'SUCCESS' | 'FAILED';
}

/**
 * Fetch EOD history for a symbol, filter by range, and persist with progress.
 * Progress phases: 5 (start) → 10 (fetched) → 15..95 (persisting) → 100 (done).
 */
export async function runHistorySync(
  symbol: string,
  range: HistoryRange,
  onProgress?: ProgressFn,
): Promise<HistorySyncSummary> {
  const sym = symbol.toUpperCase();
  const log = childLogger({ symbol: sym, op: 'history-sync', range });
  const stock = await stockRepository.findBySymbol(sym);
  if (!stock) throw new NotFoundError(`Stock not tracked: ${sym}`);

  const started = new Date();
  const syncLog = await syncLogRepository.start(sym, stock.id);
  await onProgress?.(5, 'fetching');
  log.info('history-sync.start');

  try {
    const all = await psxHistoricalScraper.fetchEod(sym);
    await onProgress?.(10, 'filtering');

    const from = rangeToFrom(range);
    const points = from ? all.filter((p) => new Date(p.date) >= from) : all;
    log.info('history-sync.filtered', { total: all.length, inRange: points.length });

    const persisted = await bulkUpsertHistory(stock.id, points, async (done, total) => {
      const percent = total === 0 ? 95 : 15 + Math.round((done / total) * 80);
      await onProgress?.(Math.min(percent, 95), 'persisting');
    });

    await onProgress?.(100, 'done');
    await syncLogRepository.complete(syncLog.id, 'SUCCESS', started);
    log.info('history-sync.complete', { persisted });
    return { symbol: sym, range, fetched: points.length, persisted, status: 'SUCCESS' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await syncLogRepository.complete(syncLog.id, 'FAILED', started, message);
    log.error('history-sync.failed', { message });
    throw err;
  }
}
