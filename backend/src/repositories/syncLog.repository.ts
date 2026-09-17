import { SyncLog, SyncStatus } from '@prisma/client';
import { prisma } from '../database/prisma';

export interface SyncLogFilter {
  symbol?: string;
  status?: SyncStatus;
  limit: number;
  offset: number;
}

export class SyncLogRepository {
  start(symbol: string | null, stockId: string | null): Promise<SyncLog> {
    return prisma.syncLog.create({
      data: { symbol, stockId, status: 'RUNNING' },
    });
  }

  complete(
    id: string,
    status: SyncStatus,
    startedAt: Date,
    errorMessage?: string,
  ): Promise<SyncLog> {
    const completedAt = new Date();
    return prisma.syncLog.update({
      where: { id },
      data: {
        status,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorMessage: errorMessage ?? null,
      },
    });
  }

  /**
   * Mark sync logs left RUNNING by a worker that died as failed.
   *
   * Nothing else completes them, so every crash (deploy, OOM, `docker restart`) left a row the
   * Sync Logs page showed as "running" indefinitely — 17 of them, the oldest three days old, which
   * makes the page useless for telling a live sync from a dead one.
   *
   * Called at worker start: a sync cannot outlive the process that owns it, so anything RUNNING
   * before this boot is by definition abandoned.
   */
  async sweepStale(maxAgeMinutes = 5): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
    const result = await prisma.syncLog.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: 'interrupted: the worker restarted before this sync completed',
      },
    });
    return result.count;
  }

  async list(f: SyncLogFilter): Promise<{ items: SyncLog[]; total: number }> {
    const where = {
      ...(f.symbol ? { symbol: f.symbol.toUpperCase() } : {}),
      ...(f.status ? { status: f.status } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.syncLog.findMany({ where, orderBy: { startedAt: 'desc' }, skip: f.offset, take: f.limit }),
      prisma.syncLog.count({ where }),
    ]);
    return { items, total };
  }
}

export const syncLogRepository = new SyncLogRepository();
