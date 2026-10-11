import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';

/** One stock in a movers list — just enough for a compact row. */
export interface MoverRow {
  symbol: string;
  companyName: string | null;
  currentPrice: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
}

/** One upcoming dividend event, sorted by its soonest future date. */
export interface DividendEventRow {
  symbol: string;
  companyName: string | null;
  announcementDate: Date | null;
  bookClosure: Date | null;
  paymentDate: Date | null;
  dividend: number | null;
}

/** One row in the highest-yield ranking. */
export interface YieldRow {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  dividendYield: number | null;
  currentPrice: number | null;
}

/** One sector's aggregate over its newest priced rows. */
export interface SectorRow {
  sector: string;
  count: number;
  avgChangePercent: number | null;
  totalMarketCap: number | null;
  advancers: number;
  decliners: number;
}

/** Market-wide breadth over the newest priced row of every tracked symbol. */
export interface MarketBreadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  totalVolume: number | null;
  newHighs: number;
  newLows: number;
}

/** Raw shape of a mover row from the query. */
type RawMover = {
  symbol: string;
  company_name: string | null;
  current_price: Prisma.Decimal | null;
  change: Prisma.Decimal | null;
  change_percent: Prisma.Decimal | null;
  volume: bigint | null;
};

const toMover = (r: RawMover): MoverRow => ({
  symbol: r.symbol,
  companyName: r.company_name,
  currentPrice: r.current_price ? Number(r.current_price) : null,
  change: r.change != null ? Number(r.change) : null,
  changePercent: r.change_percent != null ? Number(r.change_percent) : null,
  // `!= null`, not truthiness: zero shares traded is a reading, not an absent value.
  volume: r.volume != null ? Number(r.volume) : null,
});

/**
 * Aggregates and rankings over the *newest* priced row of every tracked symbol.
 *
 * Deliberately raw SQL for the same reason the stock list is: the values live on a related row
 * (the latest `stock_prices` row per symbol, or the latest `ratios` row), which Prisma's
 * `findMany` cannot order or aggregate by.
 */
export class MarketRepository {
  /** Market-wide breadth: how many advanced, declined, traded flat, hit fresh highs/lows. */
  async breadth(): Promise<MarketBreadth> {
    const rows = await prisma.$queryRaw<
      Array<{
        advancers: number;
        decliners: number;
        unchanged: number;
        total_volume: bigint;
        new_highs: number;
        new_lows: number;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE p.change_percent > 0)::int AS advancers,
        COUNT(*) FILTER (WHERE p.change_percent < 0)::int AS decliners,
        COUNT(*) FILTER (WHERE p.change_percent = 0)::int AS unchanged,
        COALESCE(SUM(p.volume), 0)::bigint AS total_volume,
        COUNT(*) FILTER (
          WHERE p.week52_high IS NOT NULL AND p.current_price >= p.week52_high
        )::int AS new_highs,
        COUNT(*) FILTER (
          WHERE p.week52_low IS NOT NULL AND p.current_price <= p.week52_low
        )::int AS new_lows
      FROM stocks s
      JOIN LATERAL (
        SELECT current_price, change_percent, volume, week52_high, week52_low
        FROM stock_prices
        WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST
        LIMIT 1
      ) p ON true
    `);
    const r = rows[0];
    return {
      advancers: r?.advancers ?? 0,
      decliners: r?.decliners ?? 0,
      unchanged: r?.unchanged ?? 0,
      totalVolume: r ? Number(r.total_volume) : null,
      newHighs: r?.new_highs ?? 0,
      newLows: r?.new_lows ?? 0,
    };
  }

  /**
   * The `n` biggest gainers, losers and most-active names, three short lists.
   *
   * `change_percent` for gainers/losers and `volume` for activity: the same numbers the
   * dashboard already shows per row, so a mover reads exactly like its row in the table.
   */
  async movers(n: number): Promise<{ gainers: MoverRow[]; losers: MoverRow[]; mostActive: MoverRow[] }> {
    const gainers = await prisma.$queryRaw<RawMover[]>(Prisma.sql`
      SELECT s.symbol, s.company_name, p.current_price, p.change, p.change_percent, p.volume
      FROM stocks s
      JOIN LATERAL (
        SELECT current_price, change, change_percent, volume
        FROM stock_prices
        WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST
        LIMIT 1
      ) p ON true
      WHERE p.change_percent > 0
      ORDER BY p.change_percent DESC NULLS LAST, s.symbol ASC
      LIMIT ${n}
    `);
    const losers = await prisma.$queryRaw<RawMover[]>(Prisma.sql`
      SELECT s.symbol, s.company_name, p.current_price, p.change, p.change_percent, p.volume
      FROM stocks s
      JOIN LATERAL (
        SELECT current_price, change, change_percent, volume
        FROM stock_prices
        WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST
        LIMIT 1
      ) p ON true
      WHERE p.change_percent < 0
      ORDER BY p.change_percent ASC NULLS LAST, s.symbol ASC
      LIMIT ${n}
    `);
    const mostActive = await prisma.$queryRaw<RawMover[]>(Prisma.sql`
      SELECT s.symbol, s.company_name, p.current_price, p.change, p.change_percent, p.volume
      FROM stocks s
      JOIN LATERAL (
        SELECT current_price, change, change_percent, volume
        FROM stock_prices
        WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST
        LIMIT 1
      ) p ON true
      WHERE p.volume IS NOT NULL
      ORDER BY p.volume DESC NULLS LAST, s.symbol ASC
      LIMIT ${n}
    `);
    return {
      gainers: gainers.map(toMover),
      losers: losers.map(toMover),
      mostActive: mostActive.map(toMover),
    };
  }

  /**
   * One row per sector, aggregated over each member's newest priced row. Sectors the source
   * left unnamed (or marked `undefined`) are dropped — a row under "undefined" is not data.
   */
  async sectors(): Promise<SectorRow[]> {
    const rows = await prisma.$queryRaw<
      Array<{
        sector: string;
        count: number;
        avg_change_percent: number | null;
        total_market_cap: Prisma.Decimal | null;
        advancers: number;
        decliners: number;
      }>
    >(Prisma.sql`
      SELECT s.sector,
             COUNT(*)::int AS count,
             AVG(p.change_percent)::float8 AS avg_change_percent,
             SUM(p.market_cap)::numeric AS total_market_cap,
             COUNT(*) FILTER (WHERE p.change_percent > 0)::int AS advancers,
             COUNT(*) FILTER (WHERE p.change_percent < 0)::int AS decliners
      FROM stocks s
      JOIN LATERAL (
        SELECT current_price, change_percent, market_cap
        FROM stock_prices
        WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST
        LIMIT 1
      ) p ON true
      WHERE s.sector IS NOT NULL AND s.sector <> 'undefined'
      GROUP BY s.sector
      ORDER BY s.sector ASC
    `);
    return rows.map((r) => ({
      sector: r.sector,
      count: r.count,
      avgChangePercent: r.avg_change_percent,
      totalMarketCap: r.total_market_cap ? Number(r.total_market_cap) : null,
      advancers: r.advancers,
      decliners: r.decliners,
    }));
  }

  /**
   * Upcoming dividend events: the source's published dividend date still ahead of now, soonest
   * first. The source publishes no book-closure or payment date (both columns stay null), so the
   * "calendar" is built from the announcement date — the dividend date it *does* publish, which
   * runs a couple of weeks ahead.
   */
  async upcomingDividends(limit: number): Promise<DividendEventRow[]> {
    const rows = await prisma.$queryRaw<
      Array<{
        symbol: string;
        company_name: string | null;
        announcement_date: Date | null;
        book_closure: Date | null;
        payment_date: Date | null;
        dividend: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      SELECT s.symbol, s.company_name, d.announcement_date, d.book_closure, d.payment_date, d.dividend
      FROM dividends d
      JOIN stocks s ON s.id = d.stock_id
      WHERE d.announcement_date >= now()
      ORDER BY d.announcement_date ASC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({
      symbol: r.symbol,
      companyName: r.company_name,
      announcementDate: r.announcement_date,
      bookClosure: r.book_closure,
      paymentDate: r.payment_date,
      dividend: r.dividend ? Number(r.dividend) : null,
    }));
  }

  /**
   * Highest dividend yield, ranked over each symbol's newest ratio row. A yield of 0 is a
   * reading; only a null (no ratio published) is excluded.
   */
  async highestYield(limit: number): Promise<YieldRow[]> {
    const rows = await prisma.$queryRaw<
      Array<{
        symbol: string;
        company_name: string | null;
        sector: string | null;
        dividend_yield: Prisma.Decimal | null;
        current_price: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      SELECT s.symbol, s.company_name, s.sector, r.dividend_yield, p.current_price
      FROM stocks s
      JOIN LATERAL (
        SELECT dividend_yield FROM ratios WHERE stock_id = s.id
        ORDER BY created_at DESC LIMIT 1
      ) r ON true
      JOIN LATERAL (
        SELECT current_price FROM stock_prices
        WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST LIMIT 1
      ) p ON true
      WHERE r.dividend_yield IS NOT NULL
      ORDER BY r.dividend_yield DESC NULLS LAST, s.symbol ASC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({
      symbol: r.symbol,
      companyName: r.company_name,
      sector: r.sector,
      dividendYield: r.dividend_yield ? Number(r.dividend_yield) : null,
      currentPrice: r.current_price ? Number(r.current_price) : null,
    }));
  }
}

export const marketRepository = new MarketRepository();
