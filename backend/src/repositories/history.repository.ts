import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import type { HistoricalPoint } from '../scrapers/historical.scraper';

const dec = (v: number | null): Prisma.Decimal | null => (v === null ? null : new Prisma.Decimal(v));

export type ChunkProgress = (persisted: number, total: number) => void | Promise<void>;

/**
 * Bulk upsert EOD points into stock_prices, idempotent on (stock_id, last_trade_date).
 * Persists in chunks and reports progress. Returns number of rows written.
 */
export async function bulkUpsertHistory(
  stockId: string,
  points: HistoricalPoint[],
  onChunk?: ChunkProgress,
  chunkSize = 100,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((p) =>
        prisma.stockPrice.upsert({
          where: { stockId_lastTradeDate: { stockId, lastTradeDate: new Date(p.date) } },
          update: { currentPrice: dec(p.close), close: dec(p.close), open: dec(p.open), volume: p.volume ? BigInt(Math.trunc(p.volume)) : null },
          create: {
            stockId,
            lastTradeDate: new Date(p.date),
            currentPrice: dec(p.close),
            close: dec(p.close),
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
