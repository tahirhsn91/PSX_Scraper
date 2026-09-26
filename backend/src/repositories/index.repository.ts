import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import type { HistoricalPoint } from '../scrapers/historical.scraper';

const dec = (v: number | null): Prisma.Decimal | null => (v === null ? null : new Prisma.Decimal(v));

export type ChunkProgress = (persisted: number, total: number) => void | Promise<void>;

export class IndexRepository {
  /** Tracked indices, each with its two newest daily values (value + previous close). */
  findAll() {
    return prisma.marketIndex.findMany({
      orderBy: { symbol: 'asc' },
      include: { values: { orderBy: { tradeDate: 'desc' }, take: 2 } },
    });
  }

  findBySymbol(symbol: string) {
    return prisma.marketIndex.findUnique({ where: { symbol: symbol.toUpperCase() } });
  }

  /** Newest daily rows, newest first. */
  latestValues(indexId: string, take = 2) {
    return prisma.indexValue.findMany({ where: { indexId }, orderBy: { tradeDate: 'desc' }, take });
  }

  countValues(indexId: string) {
    return prisma.indexValue.count({ where: { indexId } });
  }

  async listValues(
    indexId: string,
    opts: { from?: Date; to?: Date; limit: number; offset: number },
  ): Promise<{ items: Awaited<ReturnType<typeof prisma.indexValue.findMany>>; total: number }> {
    const { from, to, limit, offset } = opts;
    const where = {
      indexId,
      ...(from || to ? { tradeDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.indexValue.findMany({ where, orderBy: { tradeDate: 'desc' }, skip: offset, take: limit }),
      prisma.indexValue.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Upsert daily values, idempotent on (index_id, trade_date): re-running a sync
   * updates the day's row instead of duplicating it, and never deletes history.
   */
  /** Value rows for a window, newest first, for the candle read path. */
  async candleRows(indexId: string, from: Date | undefined, to: Date | undefined, limit = 5000) {
    return prisma.indexValue.findMany({
      where: {
        indexId,
        ...(from || to ? { tradeDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: { tradeDate: 'desc' },
      take: limit,
      select: { tradeDate: true, value: true, open: true, volume: true },
    });
  }

  async upsertValues(
    indexId: string,
    points: HistoricalPoint[],
    onChunk?: ChunkProgress,
    chunkSize = 100,
  ): Promise<number> {
    let written = 0;
    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      await prisma.$transaction(
        chunk.map((p) =>
          prisma.indexValue.upsert({
            where: { indexId_tradeDate: { indexId, tradeDate: new Date(p.date) } },
            update: {
              // `value` is required on the model, so build the Decimal directly (dec() returns null-able).
              value: new Prisma.Decimal(p.close),
              // A null means "this reading has nothing to say about the open or the volume" — it
              // must not blank what another source stored on the day's row. The market-summary
              // carousel carries no open and no volume (see `psxIndices.scraper.ts`) and it is the
              // only reachable source for indices, so without this the opening level captured at
              // 09:31 is wiped by the 09:36 pass of the same session. `undefined` drops the column
              // from the UPDATE; only a real reading overwrites one. Same rule as the market cap in
              // `scrapeResult.repository.ts`.
              open: dec(p.open) ?? undefined,
              volume: p.volume ? BigInt(Math.trunc(p.volume)) : undefined,
            },
            create: {
              indexId,
              tradeDate: new Date(p.date),
              value: new Prisma.Decimal(p.close),
              open: dec(p.open),
              volume: p.volume ? BigInt(Math.trunc(p.volume)) : null,
            },
          }),
        ),
      );
      written += chunk.length;
      await onChunk?.(written, points.length);
    }
    return written;
  }

  /**
   * Record the newest intraday reading. Deliberately leaves liveValue/liveAt untouched
   * when no reading is available: the summary only uses a live value that is newer than
   * the latest daily close, so a stale one is ignored rather than misleading.
   */
  markSynced(indexId: string, live?: { value: number; at: Date } | null) {
    return prisma.marketIndex.update({
      where: { id: indexId },
      data: {
        lastSyncedAt: new Date(),
        ...(live ? { liveValue: dec(live.value), liveAt: live.at } : {}),
      },
    });
  }
}

export const indexRepository = new IndexRepository();
