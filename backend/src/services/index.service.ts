import { indexRepository } from '../repositories/index.repository';
import { findExistingIndexJob, enqueueIndexSync } from '../jobs/queues';
import { NotFoundError } from '../types/errors';
import { rangeToFrom, HistoryRange } from '../utils/range';
import {
  buildIndexSummary,
  derivedIndexVolume,
  liveReading,
  toHistoryItem,
  toIndexCandles,
} from './indexSummary';

/**
 * Derived index volumes, for the indices where the derivation is provably PSX's own figure.
 *
 * Index volume has no reachable publisher since 2026-09-22, so the sum of the constituents is the
 * only available figure — and it is shown only where it matched PSX exactly on the newest day we
 * hold both (12 of the 17 indices; the rest keep `—`). See `derivedIndexVolume`.
 *
 * Two queries, deliberately: the scopes resolve *which* days matter (the newest session and the last
 * published day), then one range scan fetches every member's volume for those days. Doing it as one
 * correlated sum per index made the endpoint exceed the client's timeout — the sum has to compare
 * `last_trade_date` as a date, which no index can serve, so it degraded to a scan per index.
 */
async function derivedVolumes(): Promise<Map<string, number>> {
  const scopes = await indexRepository.constituentVolumeScopes();
  const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = scopes.flatMap((s) => [s.session, s.check_day].filter((d): d is Date => d != null).map(dayOf));
  if (days.length === 0) return new Map();

  const from = new Date(Math.min(...days));
  const to = new Date(Math.max(...days) + 24 * 60 * 60 * 1000);
  const sums = await indexRepository.constituentVolumeSums(scopes.map((s) => s.id), from, to);

  // A member with no volume for the day contributes nothing, which is exactly what the check on the
  // published day is there to catch: a sum short of the exchange's own figure is not shown.
  const perIndex = new Map<string, Map<number, number>>();
  for (const row of sums) {
    const byDay = perIndex.get(row.index_id) ?? new Map<number, number>();
    const day = dayOf(row.day);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(row.volume ?? 0));
    perIndex.set(row.index_id, byDay);
  }

  const derived = new Map<string, number>();
  for (const scope of scopes) {
    const byDay = perIndex.get(scope.id);
    const value = derivedIndexVolume(
      scope.session ? byDay?.get(dayOf(scope.session)) ?? null : null,
      scope.published,
      scope.check_day ? byDay?.get(dayOf(scope.check_day)) ?? null : null,
    );
    if (value !== null) derived.set(scope.symbol, value);
  }
  return derived;
}

export const indexService = {
  async list(page: number, limit: number) {
    const indices = await indexRepository.findAll();
    const derived = await derivedVolumes();
    const items = indices.map((i) =>
      buildIndexSummary({
        symbol: i.symbol,
        name: i.name,
        daily: i.values,
        live: liveReading(i.liveValue, i.liveAt, i.liveChange, i.liveChangePercent),
        constituentVolume: derived.get(i.symbol) ?? null,
      }),
    );
    // Tracked indices are a short, fixed list (KSE100 today), so paginate in memory.
    const total = items.length;
    const offset = (page - 1) * limit;
    return { items: items.slice(offset, offset + limit), page, limit, total, totalPages: Math.ceil(total / limit) };
  },

  async summary(symbol: string) {
    const sym = symbol.toUpperCase();
    const index = await indexRepository.findBySymbol(sym);
    if (!index) throw new NotFoundError(`Index not tracked: ${sym}`);
    // Two rows are enough: newest close, plus the one before it for previousClose.
    const daily = await indexRepository.latestValues(index.id, 2);
    const derived = await derivedVolumes();
    return buildIndexSummary({
      symbol: index.symbol,
      name: index.name,
      daily,
      live: liveReading(index.liveValue, index.liveAt, index.liveChange, index.liveChangePercent),
      constituentVolume: derived.get(index.symbol) ?? null,
    });
  },

  /**
   * Daily candles for an index, oldest first — the same contract as
   * `/stocks/:symbol/candles`, so the dashboard's chart component draws either.
   *
   * No plausibility filter here: index levels are not written by the stock pipeline, and the
   * sessions we hold for an index come from the exchange or from our own scrape.
   */
  async candles(symbol: string, opts: { interval?: '1D'; range?: HistoryRange; from?: Date; to?: Date }) {
    const sym = symbol.toUpperCase();
    const index = await indexRepository.findBySymbol(sym);
    if (!index) throw new NotFoundError(`Index not tracked: ${sym}`);
    const from = opts.range ? rangeToFrom(opts.range) : opts.from;
    const rows = await indexRepository.candleRows(index.id, from, opts.to);
    const items = toIndexCandles(rows);
    return {
      symbol: sym,
      interval: opts.interval ?? '1D',
      range: opts.range ?? null,
      count: items.length,
      // Never non-zero for an index: there is no contaminated-source path to filter.
      skipped: 0,
      sanitised: 0,
      from: items[0]?.time ?? null,
      to: items[items.length - 1]?.time ?? null,
      items,
    };
  },

  async history(
    symbol: string,
    opts: { range?: HistoryRange; from?: Date; to?: Date; page?: number; limit?: number },
  ) {
    const sym = symbol.toUpperCase();
    const index = await indexRepository.findBySymbol(sym);
    if (!index) throw new NotFoundError(`Index not tracked: ${sym}`);

    const page = opts.page ?? 1;
    const limit = opts.limit ?? 252;
    // A range preset takes precedence over an explicit `from`, as on the stock route.
    const from = opts.range ? rangeToFrom(opts.range) : opts.from;
    const res = await indexRepository.listValues(index.id, { from, to: opts.to, limit, offset: (page - 1) * limit });
    return {
      items: res.items.map(toHistoryItem),
      page,
      limit,
      total: res.total,
      totalPages: Math.ceil(res.total / limit),
    };
  },

  /** Enqueue an index sync, reusing an existing queued/active job (de-dupe). */
  async sync(symbol: string) {
    const sym = symbol.toUpperCase();
    const index = await indexRepository.findBySymbol(sym);
    if (!index) throw new NotFoundError(`Index not tracked: ${sym}`);

    const existing = await findExistingIndexJob(sym);
    if (existing) {
      const state = await existing.getState();
      if (['waiting', 'active', 'delayed'].includes(state)) {
        return { jobId: existing.id, symbol: sym, reused: true, state };
      }
    }
    const job = await enqueueIndexSync(sym, 'manual');
    return { jobId: job.id, symbol: sym, reused: false, state: 'waiting' };
  },

  async jobStatus(symbol: string) {
    const job = await findExistingIndexJob(symbol.toUpperCase());
    if (!job) return { state: 'none', progress: null, returnValue: null, failedReason: null };
    return {
      jobId: job.id,
      state: await job.getState(),
      progress: job.progress,
      returnValue: job.returnvalue,
      failedReason: job.failedReason,
    };
  },
};
