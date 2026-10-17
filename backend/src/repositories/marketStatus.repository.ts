import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';

/**
 * The "when did we last actually read this?" timestamps behind the data-status endpoint.
 *
 * One round trip with four correlated sub-selects rather than four awaits: each sub-select is
 * indexed (see migration 0021 for the price table) and the payload is polled every minute per
 * client, so the cost that matters is round trips, not query count.
 */
export interface DatasetTimestamps {
  /** Newest completed per-stock sync — the last time quote data was written. */
  quotesAt: Date | null;
  /** Newest index board read. */
  indicesAt: Date | null;
  /** Newest session we hold candles for. */
  candlesAt: Date | null;
  /** Newest dividend row written. */
  dividendsAt: Date | null;
}

interface RawTimestamps {
  quotes_at: Date | null;
  indices_at: Date | null;
  candles_at: Date | null;
  dividends_at: Date | null;
}

export class MarketStatusRepository {
  async timestamps(): Promise<DatasetTimestamps> {
    const rows = await prisma.$queryRaw<RawTimestamps[]>(Prisma.sql`
      SELECT
        (
          SELECT completed_at
          FROM sync_logs
          WHERE stock_id IS NOT NULL
            AND completed_at IS NOT NULL
            AND status IN ('SUCCESS', 'PARTIAL')
          ORDER BY started_at DESC
          LIMIT 1
        ) AS quotes_at,
        (SELECT MAX(last_synced_at) FROM market_indices) AS indices_at,
        (SELECT MAX(last_trade_date) FROM stock_prices) AS candles_at,
        (SELECT MAX(created_at) FROM dividends) AS dividends_at
    `);

    const r = rows[0];
    return {
      quotesAt: r?.quotes_at ?? null,
      indicesAt: r?.indices_at ?? null,
      candlesAt: r?.candles_at ?? null,
      dividendsAt: r?.dividends_at ?? null,
    };
  }
}

export const marketStatusRepository = new MarketStatusRepository();
