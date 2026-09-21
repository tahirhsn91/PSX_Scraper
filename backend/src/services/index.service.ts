import { indexRepository } from '../repositories/index.repository';
import { findExistingIndexJob, enqueueIndexSync } from '../jobs/queues';
import { NotFoundError } from '../types/errors';
import { rangeToFrom, HistoryRange } from '../utils/range';
import { buildIndexSummary, liveReading, toHistoryItem } from './indexSummary';

export const indexService = {
  async list(page: number, limit: number) {
    const indices = await indexRepository.findAll();
    const items = indices.map((i) =>
      buildIndexSummary({
        symbol: i.symbol,
        name: i.name,
        daily: i.values,
        live: liveReading(i.liveValue, i.liveAt, i.liveChange, i.liveChangePercent),
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
    return buildIndexSummary({
      symbol: index.symbol,
      name: index.name,
      daily,
      live: liveReading(index.liveValue, index.liveAt, index.liveChange, index.liveChangePercent),
    });
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
