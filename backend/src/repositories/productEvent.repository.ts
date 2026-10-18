import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { EVENT_RETENTION_DAYS } from '../analytics/events';

export interface EventSummary {
  days: number;
  total: number;
  byName: Array<{ name: string; count: number }>;
  search: { submitted: number; withResults: number; successRate: number | null };
  screens: { applied: number };
  comparisons: number;
  sync: { total: number; succeeded: number; successRate: number | null };
}

class ProductEventRepository {
  async record(name: string, path: string | null, props: Record<string, string | number | boolean> | null): Promise<void> {
    await prisma.productEvent.create({
      data: { name, path, props: (props ?? Prisma.JsonNull) as Prisma.InputJsonValue },
    });
  }

  async summary(days: number): Promise<EventSummary> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = { createdAt: { gte: since } };

    const [byName, searchRows, syncGroups] = await Promise.all([
      prisma.productEvent.groupBy({ by: ['name'], where, _count: { _all: true } }),
      // `hadResults` is the only property read here; the query text was never stored, so this is
      // "did the search succeed", not "what did people look for".
      prisma.$queryRaw<Array<{ submitted: bigint; with_results: bigint }>>`
        SELECT COUNT(*)::bigint AS submitted,
               COUNT(*) FILTER (WHERE props->>'hadResults' = 'true')::bigint AS with_results
        FROM product_events
        WHERE name = 'search_submitted' AND created_at >= ${since}
      `,
      prisma.syncLog.groupBy({ by: ['status'], where: { startedAt: { gte: since } }, _count: { _all: true } }),
    ]);

    const counts = new Map(byName.map((r) => [r.name, r._count._all]));
    const total = byName.reduce((sum, r) => sum + r._count._all, 0);

    const submitted = Number(searchRows[0]?.submitted ?? 0);
    const withResults = Number(searchRows[0]?.with_results ?? 0);

    const syncTotal = syncGroups.reduce((sum, g) => sum + g._count._all, 0);
    // PARTIAL counts as a success: the sync delivered data, just not every field.
    const syncOk = syncGroups
      .filter((g) => g.status === 'SUCCESS' || g.status === 'PARTIAL')
      .reduce((sum, g) => sum + g._count._all, 0);

    return {
      days,
      total,
      byName: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      search: {
        submitted,
        withResults,
        successRate: submitted === 0 ? null : Math.round((withResults / submitted) * 10000) / 10000,
      },
      screens: { applied: counts.get('screener_filter_applied') ?? 0 },
      comparisons: counts.get('compare_created') ?? 0,
      sync: {
        total: syncTotal,
        succeeded: syncOk,
        successRate: syncTotal === 0 ? null : Math.round((syncOk / syncTotal) * 10000) / 10000,
      },
    };
  }

  /** Deletes events past the retention window; returns how many rows went. */
  async prune(days: number = EVENT_RETENTION_DAYS): Promise<number> {
    const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const res = await prisma.productEvent.deleteMany({ where: { createdAt: { lt: before } } });
    return res.count;
  }
}

export const productEventRepository = new ProductEventRepository();
