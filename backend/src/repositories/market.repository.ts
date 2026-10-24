import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { shariahMembers } from './stock.repository';

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

/**
 * One sector's drill-down: the aggregate, its members, and the provenance of the classification.
 *
 * `source` / `updatedAt` are read from the members' newest recorded values. A sector whose members
 * were written by different providers keeps the most recent source and date — the drill-down is
 * describing the classification as it currently stands, not each row's history.
 */
export interface SectorDetail {
  sector: string;
  count: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  avgChangePercent: number | null;
  totalMarketCap: number | null;
  totalVolume: number | null;
  source: string | null;
  updatedAt: Date | null;
  /** The five biggest moves up and down inside the sector. */
  gainers: SectorConstituent[];
  losers: SectorConstituent[];
  /** Every member, biggest gain first — the full table. */
  constituents: SectorConstituent[];
}

export interface SectorConstituent {
  symbol: string;
  companyName: string | null;
  currentPrice: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;
  /** Member of the PSX-KMI All Share (Shariah) index — published membership, never inferred. */
  shariahCompliant: boolean;
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
    const mapped: SectorRow[] = rows.map((r) => ({
      sector: r.sector,
      count: r.count,
      avgChangePercent: r.avg_change_percent,
      totalMarketCap: r.total_market_cap ? Number(r.total_market_cap) : null,
      advancers: r.advancers,
      decliners: r.decliners,
    }));

    // A stock with no usable sector is still a stock. Grouping it under "Unclassified" says exactly
    // what is known — that the source published nothing — where dropping it would quietly shrink
    // the universe and inventing a sector would be worse.
    const [unclassified] = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM stocks s
      WHERE s.sector IS NULL OR TRIM(s.sector) = '' OR s.sector = 'undefined'
    `);
    const unclassifiedCount = unclassified?.count ?? 0;
    if (unclassifiedCount > 0) {
      mapped.push({
        sector: 'Unclassified',
        count: unclassifiedCount,
        avgChangePercent: null,
        totalMarketCap: null,
        advancers: 0,
        decliners: 0,
      });
    }
    return mapped;
  }

  /**
   * One sector, from the same newest-priced-row join the list uses, so the drill-down and the tile
   * cannot disagree about a member's move.
   */
  async sectorDetail(sector: string): Promise<SectorDetail | null> {
    const isUnclassified = sector === 'Unclassified';
    const predicate = isUnclassified
      ? Prisma.sql`(s.sector IS NULL OR TRIM(s.sector) = '' OR s.sector = 'undefined')`
      : Prisma.sql`s.sector = ${sector}`;

    const [summary] = await prisma.$queryRaw<
      Array<{
        count: number;
        advancers: number;
        decliners: number;
        unchanged: number;
        avg_change_percent: number | null;
        total_market_cap: Prisma.Decimal | null;
        total_volume: bigint | null;
        source: string | null;
        updated_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT COUNT(*)::int AS count,
             COUNT(*) FILTER (WHERE p.change_percent > 0)::int AS advancers,
             COUNT(*) FILTER (WHERE p.change_percent < 0)::int AS decliners,
             COUNT(*) FILTER (WHERE p.change_percent = 0)::int AS unchanged,
             AVG(p.change_percent)::float8 AS avg_change_percent,
             SUM(p.market_cap)::numeric AS total_market_cap,
             SUM(p.volume)::bigint AS total_volume,
             (ARRAY_AGG(s.sector_source ORDER BY s.sector_updated_at DESC NULLS LAST))[1] AS source,
             MAX(s.sector_updated_at) AS updated_at
      FROM stocks s
      JOIN LATERAL (
        SELECT current_price, change_percent, market_cap, volume
        FROM stock_prices
        WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST
        LIMIT 1
      ) p ON true
      WHERE ${predicate}
    `);

    if (!summary || summary.count === 0) return null;

    const rows = await prisma.$queryRaw<
      Array<{
        symbol: string;
        company_name: string | null;
        current_price: Prisma.Decimal | null;
        change_percent: Prisma.Decimal | null;
        market_cap: Prisma.Decimal | null;
        volume: bigint | null;
      }>
    >(Prisma.sql`
      SELECT s.symbol, s.company_name, p.current_price, p.change_percent, p.market_cap, p.volume
      FROM stocks s
      JOIN LATERAL (
        SELECT current_price, change_percent, market_cap, volume
        FROM stock_prices
        WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST
        LIMIT 1
      ) p ON true
      WHERE ${predicate}
      ORDER BY p.change_percent DESC NULLS LAST, s.symbol ASC
    `);

    const constituents: SectorConstituent[] = rows.map((r) => ({
      symbol: r.symbol,
      companyName: r.company_name,
      currentPrice: r.current_price != null ? Number(r.current_price) : null,
      changePercent: r.change_percent != null ? Number(r.change_percent) : null,
      marketCap: r.market_cap != null ? Number(r.market_cap) : null,
      volume: r.volume != null ? Number(r.volume) : null,
      // Filled below, once, for the whole sector.
      shariahCompliant: false,
    }));

    const members = await shariahMembers(constituents.map((c) => c.symbol));
    for (const c of constituents) c.shariahCompliant = members.has(c.symbol);

    return {
      sector,
      count: summary.count,
      advancers: summary.advancers,
      decliners: summary.decliners,
      unchanged: summary.unchanged,
      avgChangePercent: summary.avg_change_percent,
      totalMarketCap: summary.total_market_cap != null ? Number(summary.total_market_cap) : null,
      totalVolume: summary.total_volume != null ? Number(summary.total_volume) : null,
      source: summary.source,
      updatedAt: summary.updated_at,
      gainers: constituents.filter((c) => (c.changePercent ?? 0) > 0).slice(0, 5),
      losers: constituents
        .filter((c) => (c.changePercent ?? 0) < 0)
        .slice(-5)
        .reverse(),
      constituents,
    };
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
   * The dividend ledger: one row per declared dividend, with the dates the source actually carries.
   *
   * `ex_date` comes from the table, which is currently always null — the provider publishes no
   * ex-dividend date, and inferring one from the book-closure date would invent a fact that feeds
   * price adjustment later. The column exists so the notice feed can fill it, not so the UI can guess.
   *
   * `yieldTtm` = everything declared in the last 365 days ÷ the latest price. The window is stated
   * in the UI because "dividend yield" is otherwise a number with no definition attached.
   */
  async dividendLedger(q: {
    symbol?: string;
    from?: Date;
    to?: Date;
    minYield?: number;
    page: number;
    limit: number;
  }) {
    const where = [
      q.symbol ? Prisma.sql`AND s.symbol = ${q.symbol.toUpperCase()}` : Prisma.empty,
      q.from ? Prisma.sql`AND d.announcement_date >= ${q.from}` : Prisma.empty,
      q.to ? Prisma.sql`AND d.announcement_date <= ${q.to}` : Prisma.empty,
    ];

    const base = Prisma.sql`
      WITH price AS (
        SELECT s.id AS stock_id,
               COALESCE(
                 (SELECT sp.current_price FROM stock_prices sp
                   WHERE sp.stock_id = s.id AND sp.current_price IS NOT NULL
                   ORDER BY sp.last_trade_date DESC LIMIT 1),
                 (SELECT sp.close FROM stock_prices sp
                   WHERE sp.stock_id = s.id
                   ORDER BY sp.last_trade_date DESC LIMIT 1)
               ) AS price
        FROM stocks s
      ),
      ttm AS (
        SELECT stock_id, SUM(dividend) AS amount
        FROM dividends
        WHERE announcement_date >= (CURRENT_DATE - INTERVAL '365 days')
        GROUP BY stock_id
      )
      SELECT s.symbol, s.company_name, d.dividend, d.announcement_date, d.book_closure, d.payment_date,
             d.ex_date, p.price, t.amount AS ttm_amount,
             CASE
               WHEN d.payment_date IS NOT NULL AND d.payment_date <= CURRENT_DATE THEN 'paid'
               WHEN d.payment_date IS NULL THEN 'unknown'
               ELSE 'declared'
             END AS status
      FROM dividends d
      JOIN stocks s ON s.id = d.stock_id
      LEFT JOIN price p ON p.stock_id = d.stock_id
      LEFT JOIN ttm t ON t.stock_id = d.stock_id
      WHERE TRUE ${Prisma.join(where, ' ')}
    `;

    const rows = await prisma.$queryRaw<
      Array<{
        symbol: string;
        company_name: string | null;
        dividend: Prisma.Decimal | null;
        announcement_date: Date | null;
        book_closure: Date | null;
        payment_date: Date | null;
        ex_date: Date | null;
        price: Prisma.Decimal | null;
        ttm_amount: Prisma.Decimal | null;
        status: string;
      }>
    >(Prisma.sql`
      SELECT * FROM (${base}) led
      ${
        q.minYield != null
          ? Prisma.sql`WHERE led.ttm_amount IS NOT NULL AND led.price > 0
              AND (led.ttm_amount / led.price * 100) >= ${q.minYield}`
          : Prisma.empty
      }
      ORDER BY led.announcement_date DESC NULLS LAST, led.symbol ASC
      LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}
    `);

    const counted = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total FROM (${base}) led
      ${
        q.minYield != null
          ? Prisma.sql`WHERE led.ttm_amount IS NOT NULL AND led.price > 0
              AND (led.ttm_amount / led.price * 100) >= ${q.minYield}`
          : Prisma.empty
      }
    `);

    return {
      total: Number(counted[0]?.total ?? 0),
      items: rows.map((r) => {
        const price = r.price != null ? Number(r.price) : null;
        const ttm = r.ttm_amount != null ? Number(r.ttm_amount) : null;
        return {
          symbol: r.symbol,
          companyName: r.company_name,
          amount: r.dividend != null ? Number(r.dividend) : null,
          announcementDate: r.announcement_date ? r.announcement_date.toISOString().slice(0, 10) : null,
          bookClosure: r.book_closure ? r.book_closure.toISOString().slice(0, 10) : null,
          paymentDate: r.payment_date ? r.payment_date.toISOString().slice(0, 10) : null,
          exDate: r.ex_date ? r.ex_date.toISOString().slice(0, 10) : null,
          status: r.status,
          price,
          yieldTtm: price && price > 0 && ttm != null ? (ttm / price) * 100 : null,
        };
      }),
    };
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
