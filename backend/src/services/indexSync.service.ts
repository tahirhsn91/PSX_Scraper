import { psxHistoricalScraper } from '../scrapers/historical.scraper';
import { indexRepository } from '../repositories/index.repository';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { childLogger } from '../utils/logger';
import { NotFoundError } from '../types/errors';

export type ProgressFn = (percent: number, note?: string) => Promise<void> | void;

export interface IndexSyncSummary {
  symbol: string;
  name: string;
  fetched: number;
  persisted: number;
  value: number | null;
  status: 'SUCCESS' | 'FAILED';
}

/**
 * Days of history re-fetched on a routine sync. The first sync for an index takes the
 * whole upstream series (so `range=MAX` has data to serve); afterwards only this tail is
 * re-upserted, which keeps hourly cron runs cheap while still self-healing recent gaps.
 */
const INCREMENTAL_WINDOW_DAYS = 120;

/**
 * Core index sync: fetch the DPS time series, persist daily values (idempotent per trade
 * date) and record the newest intraday reading. Used by the worker.
 * Throws on hard failure so BullMQ can apply its retry policy.
 */
export async function runIndexSync(symbol: string, onProgress?: ProgressFn): Promise<IndexSyncSummary> {
  const sym = symbol.toUpperCase();
  const log = childLogger({ symbol: sym, op: 'index-sync' });
  const index = await indexRepository.findBySymbol(sym);
  if (!index) throw new NotFoundError(`Index not tracked: ${sym}`);

  const started = new Date();
  // Index syncs are logged with symbol + null stockId: they belong to no stock row, and
  // this keeps them visible in GET /api/v1/sync/logs?symbol=KSE100.
  const syncLog = await syncLogRepository.start(sym, null);
  await onProgress?.(5, 'fetching');
  log.info('index-sync.start');

  try {
    const all = await psxHistoricalScraper.fetchEod(sym);
    await onProgress?.(35, 'filtering');

    const existingRows = await indexRepository.countValues(index.id);
    const cutoff = existingRows > 0 ? new Date(Date.now() - INCREMENTAL_WINDOW_DAYS * 86_400_000) : null;
    const points = cutoff ? all.filter((p) => new Date(p.date) >= cutoff) : all;
    log.info('index-sync.filtered', {
      total: all.length,
      toPersist: points.length,
      mode: cutoff ? 'incremental' : 'backfill',
    });

    const persisted = await indexRepository.upsertValues(index.id, points, async (done, total) => {
      const percent = total === 0 ? 90 : 35 + Math.round((done / total) * 55);
      await onProgress?.(Math.min(percent, 90), 'persisting');
    });

    // Intraday is best-effort: the daily series alone already gives a value + history.
    await onProgress?.(95, 'intraday');
    const live = await psxHistoricalScraper
      .fetchIntraday(sym)
      .then((rows) => (rows.length ? { value: rows[0]!.value, at: new Date(rows[0]!.date) } : null))
      .catch((err: unknown) => {
        log.warn('index-sync.intraday_failed', { error: err instanceof Error ? err.message : String(err) });
        return null;
      });

    await indexRepository.markSynced(index.id, live);
    await onProgress?.(100, 'done');
    await syncLogRepository.complete(syncLog.id, 'SUCCESS', started);
    log.info('index-sync.complete', { persisted, live: live?.value ?? null });
    return { symbol: sym, name: index.name, fetched: points.length, persisted, value: live?.value ?? null, status: 'SUCCESS' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await syncLogRepository.complete(syncLog.id, 'FAILED', started, message);
    log.error('index-sync.failed', { message });
    throw err;
  }
}
