import { prisma } from '../database/prisma';

/**
 * The stored contribution of each constituent to an index.
 *
 * A reading, not history: one row per (index, stock), overwritten on every pass. Membership is
 * replaced for the same reason the member list is — a company that leaves an index must stop being
 * reported as contributing to it, or the column keeps showing a contribution from a stock the index
 * no longer carries.
 */
export interface ContributionInput {
  stockId: string;
  /** Index points contributed, signed — null when the source published no reading. */
  points: number | null;
  weight: number | null;
  level: number | null;
}

export interface ContributionWriteResult {
  written: number;
  removed: number;
}

export const indexContributionRepository = {
  /**
   * Overwrite the index's contributions with `rows`, in one transaction.
   *
   * `removed` counts rows dropped because their stock is no longer in the payload — the pass's own
   * report of a membership change, so a log line says whether the index moved rather than leaving it
   * to be noticed.
   */
  async replaceForIndex(
    indexId: string,
    rows: ContributionInput[],
    capturedAt: Date,
  ): Promise<ContributionWriteResult> {
    const existing = await prisma.indexContribution.findMany({
      where: { indexId },
      select: { stockId: true },
    });
    const incoming = new Set(rows.map((row) => row.stockId));
    const removed = existing.map((row) => row.stockId).filter((id) => !incoming.has(id));

    await prisma.$transaction([
      ...rows.map((row) =>
        prisma.indexContribution.upsert({
          where: { indexId_stockId: { indexId, stockId: row.stockId } },
          update: { points: row.points, weight: row.weight, level: row.level, capturedAt },
          create: {
            indexId,
            stockId: row.stockId,
            points: row.points,
            weight: row.weight,
            level: row.level,
            capturedAt,
          },
        }),
      ),
      prisma.indexContribution.deleteMany({ where: { indexId, stockId: { in: removed } } }),
    ]);

    return { written: rows.length, removed: removed.length };
  },

  /** One stock's stored contribution to each index it belongs to, newest reading first. */
  async forStock(stockId: string) {
    return prisma.indexContribution.findMany({
      where: { stockId },
      orderBy: { capturedAt: 'desc' },
      select: {
        points: true,
        weight: true,
        level: true,
        capturedAt: true,
        index: { select: { symbol: true, name: true } },
      },
    });
  },

  /** When the index's readings were last taken, so a caller can say how fresh they are. */
  async lastCapturedAt(indexSymbol: string): Promise<Date | null> {
    const row = await prisma.indexContribution.findFirst({
      where: { index: { symbol: indexSymbol.toUpperCase() } },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true },
    });
    return row?.capturedAt ?? null;
  },
};
