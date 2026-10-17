import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';

/**
 * One stock's ranking inputs, read once for every symbol.
 *
 * Everything the movers page needs is a function of the last ~25 sessions: the newest row (price,
 * change, volume), the 20-session average volume, and the closes five and twenty-one sessions back.
 * One window-function pass over that window beats three queries per symbol, and the window is
 * bounded — 511 symbols × 25 sessions is a few thousand rows, not the whole 1.1 M-row table.
 */
export interface MoverStatRow {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  sessionDate: string | null;
  avgVolume20: number | null;
  close1w: number | null;
  close1m: number | null;
  /** Previous session's close, for a 1-day return when the source published no change%. */
  prevClose: number | null;
  /** How many stored sessions the averages were built from — a relative volume on two rows is noise. */
  sessions: number;
}

type Raw = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  price: Prisma.Decimal | null;
  change: Prisma.Decimal | null;
  change_percent: Prisma.Decimal | null;
  volume: bigint | null;
  session_date: Date | null;
  avg_volume_20: Prisma.Decimal | null;
  close_1w: Prisma.Decimal | null;
  close_1m: Prisma.Decimal | null;
  prev_close: Prisma.Decimal | null;
  sessions: bigint;
};

const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

export class MoversRepository {
  async stats(): Promise<MoverStatRow[]> {
    const rows = await prisma.$queryRaw<Raw[]>(Prisma.sql`
      WITH latest AS (
        SELECT MAX(last_trade_date) AS d FROM stock_prices
      ), windowed AS (
        SELECT
          p.stock_id, p.current_price, p.close, p.volume, p.change, p.change_percent, p.last_trade_date,
          ROW_NUMBER() OVER (PARTITION BY p.stock_id ORDER BY p.last_trade_date DESC) AS rn
        FROM stock_prices p, latest
        -- A calendar month plus the 20-session average window; wider than either so a long holiday
        -- block cannot starve the averages.
        WHERE p.last_trade_date > latest.d - interval '45 days'
      )
      SELECT
        s.symbol,
        s.company_name,
        s.sector,
        MAX(CASE WHEN w.rn = 1 THEN w.current_price END) AS price,
        MAX(CASE WHEN w.rn = 1 THEN w.change END) AS change,
        MAX(CASE WHEN w.rn = 1 THEN w.change_percent END) AS change_percent,
        MAX(CASE WHEN w.rn = 1 THEN w.volume END) AS volume,
        MAX(CASE WHEN w.rn = 1 THEN w.last_trade_date END) AS session_date,
        AVG(w.volume) FILTER (WHERE w.rn <= 20) AS avg_volume_20,
        MAX(CASE WHEN w.rn = 6 THEN w.close END) AS close_1w,
        MAX(CASE WHEN w.rn = 21 THEN w.close END) AS close_1m,
        MAX(CASE WHEN w.rn = 2 THEN w.close END) AS prev_close,
        COUNT(*) AS sessions
      FROM windowed w
      JOIN stocks s ON s.id = w.stock_id
      GROUP BY s.symbol, s.company_name, s.sector
      HAVING MAX(CASE WHEN w.rn = 1 THEN w.current_price END) IS NOT NULL
    `);

    return rows.map((r) => ({
      symbol: r.symbol,
      companyName: r.company_name,
      sector: r.sector,
      price: num(r.price),
      change: num(r.change),
      changePercent: num(r.change_percent),
      volume: r.volume !== null ? Number(r.volume) : null,
      sessionDate: r.session_date ? r.session_date.toISOString() : null,
      avgVolume20: num(r.avg_volume_20),
      close1w: num(r.close_1w),
      close1m: num(r.close_1m),
      prevClose: num(r.prev_close),
      sessions: Number(r.sessions),
    }));
  }
}

export const moversRepository = new MoversRepository();
