import { prisma } from '../database/prisma';

/**
 * Which tracked symbols make up a published index.
 *
 * The dashboard's first page is the index's member list, so this table is a *presentation* input
 * as much as data: the `list` query filters on it, and a stale row set means page one shows last
 * season's index. That is why a pass replaces the set rather than accumulating into it.
 */
export interface ConstituentInput {
  stockId: string;
  name: string | null;
  position: number | null;
}

export interface ReplaceResult {
  added: number;
  removed: number;
  kept: number;
}

export const indexConstituentRepository = {
  /** The index's member set, in the source's own order. */
  async listForIndex(indexSymbol: string) {
    const index = await prisma.marketIndex.findUnique({
      where: { symbol: indexSymbol.toUpperCase() },
      select: { id: true },
    });
    if (!index) return [];
    return prisma.indexConstituent.findMany({
      where: { indexId: index.id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { stockId: true, name: true, position: true, stock: { select: { symbol: true } } },
    });
  },

  /**
   * Replace the index's member set with `rows`, in one transaction.
   *
   * Replace, not merge: a company that has left the index has to leave this table too, or the
   * dashboard's first page keeps a former constituent for as long as nobody looks. `kept` counts
   * rows that were already members, so the log says whether a pass changed anything.
   */
  async replaceForIndex(indexId: string, rows: ConstituentInput[]): Promise<ReplaceResult> {
    const existing = await prisma.indexConstituent.findMany({
      where: { indexId },
      select: { stockId: true },
    });
    const existingIds = new Set(existing.map((row) => row.stockId));
    const incomingIds = new Set(rows.map((row) => row.stockId));

    const added = rows.filter((row) => !existingIds.has(row.stockId));
    const removed = [...existingIds].filter((id) => !incomingIds.has(id));

    await prisma.$transaction([
      ...rows.map((row) =>
        prisma.indexConstituent.upsert({
          where: { indexId_stockId: { indexId, stockId: row.stockId } },
          update: { name: row.name, position: row.position },
          create: {
            indexId,
            stockId: row.stockId,
            name: row.name,
            position: row.position,
          },
        }),
      ),
      prisma.indexConstituent.deleteMany({
        where: { indexId, stockId: { in: removed } },
      }),
    ]);

    return { added: added.length, removed: removed.length, kept: existingIds.size - removed.length };
  },

  /**
   * How the tracked universe splits for the dashboard: the index's members and everything else.
   *
   * One query for both numbers, because the list page needs them together — the first page is the
   * member set, and the pager's page count is decided by what is left.
   */
  async groupCounts(indexSymbol: string): Promise<{ members: number; rest: number }> {
    const rows = await prisma.$queryRaw<Array<{ members: number; rest: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE c.stock_id IS NOT NULL)::int AS members,
        COUNT(*) FILTER (WHERE c.stock_id IS NULL)::int     AS rest
      FROM stocks s
      LEFT JOIN index_constituents c
        ON c.stock_id = s.id
       AND c.index_id = (SELECT id FROM market_indices WHERE symbol = ${indexSymbol.toUpperCase()})
    `;
    return rows[0] ?? { members: 0, rest: 0 };
  },
};
