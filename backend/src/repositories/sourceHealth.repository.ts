import { prisma } from '../database/prisma';
import { ProviderOutcome } from '../types/dto';

/**
 * Per-source scrape health (#214).
 *
 * One row per provider id from `backend/src/data-sources.ts`. Updated by the scrape runner after a
 * symbol is attempted, so `GET /sync/sources` can answer "is this provider working right now" with
 * something better than a hunch.
 *
 * Writes are **best-effort**: a failure to record health must never fail the scrape it describes.
 */

export interface SourceHealthRow {
  source: string;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  successCount: number;
  failureCount: number;
  updatedAt: Date;
}

class SourceHealthRepository {
  async record(outcomes: ProviderOutcome[]): Promise<void> {
    if (outcomes.length === 0) return;
    const now = new Date();

    await prisma.$transaction(
      outcomes.map((o) =>
        o.ok
          ? prisma.sourceHealth.upsert({
              where: { source: o.source },
              create: { source: o.source, successCount: 1, lastSuccessAt: now },
              update: { successCount: { increment: 1 }, lastSuccessAt: now },
            })
          : prisma.sourceHealth.upsert({
              where: { source: o.source },
              create: {
                source: o.source,
                failureCount: 1,
                lastFailureAt: now,
                lastError: (o.error ?? 'unknown error').slice(0, 500),
              },
              update: {
                failureCount: { increment: 1 },
                lastFailureAt: now,
                lastError: (o.error ?? 'unknown error').slice(0, 500),
              },
            }),
      ),
    );
  }

  async list(): Promise<SourceHealthRow[]> {
    const rows = await prisma.sourceHealth.findMany({ orderBy: { source: 'asc' } });
    return rows.map((r) => ({
      source: r.source,
      lastSuccessAt: r.lastSuccessAt,
      lastFailureAt: r.lastFailureAt,
      lastError: r.lastError,
      successCount: r.successCount,
      failureCount: r.failureCount,
      updatedAt: r.updatedAt,
    }));
  }

  /** Test/ops helper: forget one source's counters. */
  async clear(source?: string): Promise<number> {
    const res = source
      ? await prisma.sourceHealth.deleteMany({ where: { source } })
      : await prisma.sourceHealth.deleteMany({});
    return res.count;
  }
}

export const sourceHealthRepository = new SourceHealthRepository();