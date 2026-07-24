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
