import { Prisma, Stock } from '@prisma/client';
import { prisma } from '../database/prisma';

export interface StockListItem {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  currentPrice: number | null;
  /**
   * Absolute change for the session, in the exchange's own units. Optional, and only ever set
   * when a price row actually carried one: the historical backfill has no `change`, so an older
   * session leaves the key absent instead of reporting a fabricated zero.
   */
  change?: number | null;
  changePercent: number | null;
  /** Session volume; null when the source carried none. */
  volume: number | null;
  /**
   * Market capitalisation in rupees, from whichever provider published it. Optional and absent
   * when no reachable source reported a figure — the dashboard renders the dash, and a missing
   * cap is never inferred from the price.
   */
  marketCap?: number | null;
  /** 52-week range (#25); null when the company page carried no such block. */
  week52High: number | null;
  week52Low: number | null;
  lastTradeDate: Date | null;
  lastSyncedAt: Date | null;
}

/**
 * Columns the dashboard may sort by.
 *
 * A whitelist rather than a filter: `sort` arrives in a query string and the ORDER BY is raw
 * SQL, so the value must never travel as text. Only these fragments do — an unrecognised key
 * simply has no column and the request is rejected by the validator before it gets here.
 */
export const SORTABLE_COLUMNS = {
  symbol: 's.symbol',
  price: 'p.current_price',
  week52Low: 'p.week52_low',
  week52High: 'p.week52_high',
  change: 'p.change',
  changePercent: 'p.change_percent',
  volume: 'p.volume',
  marketCap: 'p.market_cap',
} as const;

export type StockSortField = keyof typeof SORTABLE_COLUMNS;
export type SortOrder = 'asc' | 'desc';

/**
 * The two halves the dashboard's first page splits the universe into.
 *
 * `kse100` is the index's published member list (page one), `rest` is every other tracked symbol
 * (page two onward, 50 rows a page). Absent means the whole universe in one sequence — the
 * behaviour every other caller already had.
 */
export type StockListGroup = 'kse100' | 'rest';

/** The index whose member list drives page one. */
export const DASHBOARD_GROUP_INDEX = 'KSE100';

/**
 * The EXISTS fragment for one index's member list.
 *
 * The index symbol is a **bound parameter**, never assembled into the text: the fragment is raw
 * SQL and the symbol arrives in a query string, so it must not be able to change the query it
 * takes part in. One fragment for every index — the KSE-100 group and an `index=` filter differ
 * only in the symbol they carry.
 */
function membershipFilter(indexSymbol: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM index_constituents c
     WHERE c.stock_id = s.id
       AND c.index_id = (SELECT id FROM market_indices WHERE symbol = ${indexSymbol})
  )`;
}

/**
 * WHERE clause for the list query, as a composable fragment.
 *
 * Membership is read from `index_constituents` on every request rather than from a column on
 * `stocks`, so a rebalance takes effect the moment the membership pass writes — and a symbol that
 * leaves the index cannot be left behind on page one by a missed update.
 *
 * `index` wins over `group` when both arrive: a caller that names an index is asking a narrower
 * question than the dashboard's page-one split, and intersecting the two would answer an empty
 * page for every index but KSE100 with nothing in the response to say why. Whether the named index
 * exists is decided before the query runs (see `stockService.list`), so a typo is a 400 rather
 * than an empty page.
 */
export function buildListFilter(group?: StockListGroup, index?: string): Prisma.Sql {
  if (index) return Prisma.sql`WHERE ${membershipFilter(index)}`;
  if (!group) return Prisma.sql``;
  const member = membershipFilter(DASHBOARD_GROUP_INDEX);
  return group === 'kse100' ? Prisma.sql`WHERE ${member}` : Prisma.sql`WHERE NOT ${member}`;
}


export const STOCK_SORT_FIELDS = Object.keys(SORTABLE_COLUMNS) as [StockSortField, ...StockSortField[]];

/**
 * ORDER BY for the stocks list.
 *
 * `NULLS LAST` in *both* directions, deliberately: a missing price is not the cheapest price.
 * About 500 symbols are walked and some sessions leave a field unreported; ascending a price
 * column with nulls first would open the dashboard on a page of dashes, and descending it
 * would bury them behind every real row. Missing readings belong at the bottom either way.
 *
 * Symbol breaks ties, so a page is stable when many rows share a value (0.00% is common).
 */
export function buildOrderBy(sort: StockSortField | undefined, order: SortOrder): string {
  const column = sort ? SORTABLE_COLUMNS[sort] : SORTABLE_COLUMNS.symbol;
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  return `${column} ${direction} NULLS LAST, s.symbol ASC`;
}

type RawStockListRow = {
  id: string;
  symbol: string;
  company_name: string | null;
  sector: string | null;
  current_price: Prisma.Decimal | null;
  change: Prisma.Decimal | null;
  change_percent: Prisma.Decimal | null;
  volume: bigint | null;
  market_cap: Prisma.Decimal | null;
  week52_high: Prisma.Decimal | null;
  week52_low: Prisma.Decimal | null;
  last_trade_date: Date | null;
  last_synced_at: Date | null;
};

/** One mapping for both list and search — they read the same columns and must agree. */
function toListItem(r: RawStockListRow): StockListItem {
  const item: StockListItem = {
    id: r.id,
    symbol: r.symbol,
    companyName: r.company_name,
    sector: r.sector,
    currentPrice: r.current_price ? Number(r.current_price) : null,
    changePercent: r.change_percent ? Number(r.change_percent) : null,
    // `!= null`, not truthiness: 0 shares traded is a reading, not an absent value.
    volume: r.volume != null ? Number(r.volume) : null,
    week52High: r.week52_high ? Number(r.week52_high) : null,
    week52Low: r.week52_low ? Number(r.week52_low) : null,
    lastTradeDate: r.last_trade_date,
    lastSyncedAt: r.last_synced_at,
  };
  // Additive: set only when the row carries one, so callers that read an older session keep the
  // exact shape they had before this field existed.
  if (r.change != null) item.change = Number(r.change);
  // Same additive rule: a row with no cap keeps the key absent rather than reporting a zero.
  if (r.market_cap != null) item.marketCap = Number(r.market_cap);
  return item;
}

/**
 * Write fetched market caps onto each symbol's **newest** price row — the one the dashboard reads.
 *
 * Deliberately not an insert: a market cap belongs to the session row it was read for, and adding
 * a row here would fabricate a price tick that never happened. Symbols with no cap are simply not
 * in the arrays, so their existing (absent) value is left alone — nothing is written as zero.
 *
 * `symbols` and `caps` are parallel arrays; the caller builds them from the same snapshot list.
 */
export async function updateLatestMarketCaps(
  symbols: string[],
  caps: number[],
): Promise<number> {
  if (symbols.length === 0) return 0;
  return prisma.$executeRaw`
    UPDATE stock_prices sp
    SET market_cap = v.cap
    FROM (
      SELECT unnest(${symbols}::text[]) AS symbol, unnest(${caps}::numeric[]) AS cap
    ) v
    JOIN stocks s ON s.symbol = v.symbol
    WHERE sp.stock_id = s.id
      AND sp.last_trade_date = (
        SELECT max(x.last_trade_date) FROM stock_prices x WHERE x.stock_id = s.id
      )
  `;
}

/**
 * Tracked symbols whose newest priced row carries no market cap — the gap-fill's work list.
 *
 * Narrowing the walk to these is what keeps the refresh polite: once a symbol has a cap, later runs
 * ask nobody about it, so a refresh costs the scanner's batched POSTs plus whatever genuinely still
 * needs filling, and that set only shrinks.
 */
export async function findSymbolsWithoutLatestMarketCap(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ symbol: string }>>`
    SELECT s.symbol
    FROM stocks s
    JOIN LATERAL (
      SELECT market_cap FROM stock_prices
      WHERE stock_id = s.id AND current_price IS NOT NULL
      ORDER BY last_trade_date DESC NULLS LAST
      LIMIT 1
    ) p ON true
    WHERE p.market_cap IS NULL
    ORDER BY s.symbol
  `;
  return rows.map((r) => r.symbol);
}

/**
 * Clear the market cap on each symbol's newest price row.
 *
 * Used when a freshly-read cap is rejected (a gap-fill collision, see `dropSharedGapValues`): leaving
 * the old value in place would preserve exactly the wrong number we just refused, so the row goes
 * back to a dash until a source it trusts reports one.
 */
export async function clearLatestMarketCap(symbols: string[]): Promise<number> {
  if (symbols.length === 0) return 0;
  return prisma.$executeRaw`
    UPDATE stock_prices sp
    SET market_cap = NULL
    FROM stocks s
    WHERE s.id = sp.stock_id
      AND s.symbol = ANY(${symbols})
      AND sp.last_trade_date = (
        SELECT max(x.last_trade_date) FROM stock_prices x WHERE x.stock_id = sp.stock_id
      )
  `;
}

/**
 * Carry each symbol's most recent known cap onto its newest row, where that row has none.
 *
 * Without this the column flickers: a market cap is fetched every half hour, but the universe sync
 * writes fresh price rows continuously, and a new row starts with no cap — so a symbol that was
 * filled at 10:00 reads as a dash again by 10:05. The cap a session row shows is therefore the most
 * recent one *reported* for that symbol (the same way the 52-week range persists), not a claim that
 * it was re-read in that tick. Only rows with no value at all are touched.
 */
export async function carryForwardLatestMarketCaps(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE stock_prices sp
    SET market_cap = prev.cap
    FROM (
      SELECT DISTINCT ON (stock_id) stock_id, market_cap AS cap
      FROM stock_prices
      WHERE market_cap IS NOT NULL
      ORDER BY stock_id, last_trade_date DESC
    ) prev
    WHERE sp.stock_id = prev.stock_id
      AND sp.market_cap IS NULL
      AND sp.last_trade_date = (
        SELECT max(x.last_trade_date) FROM stock_prices x WHERE x.stock_id = sp.stock_id
      )
  `;
}

export class StockRepository {
  findBySymbol(symbol: string): Promise<Stock | null> {
    return prisma.stock.findUnique({ where: { symbol: symbol.toUpperCase() } });
  }

  /**
   * A page of tracked symbols with their newest priced row.
   *
   * Raw SQL rather than `findMany` because the sort key lives on a *related* row: price,
   * 52-week range, change and volume are those of the latest session, and Prisma cannot order
   * by "the field of the newest related row". The LATERAL join below picks that row (skipping
   * price-less ones, so a bad tick cannot blank a symbol) and the whitelisted ORDER BY sorts
   * on it. Same shape as the search query, on purpose.
   */
  async list(
    limit: number,
    offset: number,
    sort?: StockSortField,
    order: SortOrder = 'asc',
    group?: StockListGroup,
    index?: string,
  ): Promise<{ items: StockListItem[]; total: number }> {
    const filter = buildListFilter(group, index);
    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<RawStockListRow[]>(Prisma.sql`
        SELECT s.id, s.symbol, s.company_name, s.sector,
               p.current_price, p.change, p.change_percent, p.volume, p.market_cap,
               p.week52_high, p.week52_low,
               p.last_trade_date,
               sl.completed_at AS last_synced_at
        FROM stocks s
        LEFT JOIN LATERAL (
          SELECT current_price, change, change_percent, volume, market_cap, week52_high,
                 week52_low, last_trade_date
          FROM stock_prices WHERE stock_id = s.id AND current_price IS NOT NULL
          ORDER BY last_trade_date DESC NULLS LAST LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT completed_at FROM sync_logs
          WHERE stock_id = s.id
          ORDER BY started_at DESC LIMIT 1
        ) sl ON true
        ${filter}
        -- Prisma.raw, not a bound parameter: ORDER BY cannot take one. The string is safe by
        -- construction — it is assembled from the SORTABLE_COLUMNS literals above and an enum
        -- the validator already checked; no request text reaches it (see buildOrderBy's test).
        ORDER BY ${Prisma.raw(buildOrderBy(sort, order))}
        LIMIT ${limit} OFFSET ${offset}
      `),
      prisma.$queryRaw<Array<{ total: number }>>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM stocks s ${filter}`,
      ),
    ]);
    return { items: rows.map(toListItem), total: totals[0]?.total ?? 0 };
  }

  create(symbol: string): Promise<Stock> {
    return prisma.stock.create({ data: { symbol: symbol.toUpperCase() } });
  }

  async delete(symbol: string): Promise<void> {
    await prisma.stock.delete({ where: { symbol: symbol.toUpperCase() } });
  }

  async findAllSymbols(): Promise<string[]> {
    const rows = await prisma.stock.findMany({ select: { symbol: true } });
    return rows.map((r) => r.symbol);
  }

  /** Trigram fuzzy search on symbol/company, ranked by similarity (exact symbol first). */
  async search(q: string, limit: number): Promise<StockListItem[]> {
    const term = q.trim();
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        symbol: string;
        company_name: string | null;
        sector: string | null;
        current_price: Prisma.Decimal | null;
        change: Prisma.Decimal | null;
        change_percent: Prisma.Decimal | null;
        volume: bigint | null;
        market_cap: Prisma.Decimal | null;
        week52_high: Prisma.Decimal | null;
        week52_low: Prisma.Decimal | null;
        last_trade_date: Date | null;
        last_synced_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT s.id, s.symbol, s.company_name, s.sector,
             p.current_price, p.change, p.change_percent, p.volume, p.market_cap,
             p.week52_high, p.week52_low,
             p.last_trade_date,
             sl.completed_at AS last_synced_at
      FROM stocks s
      LEFT JOIN LATERAL (
        SELECT current_price, change, change_percent, volume, market_cap, week52_high,
               week52_low, last_trade_date
        FROM stock_prices WHERE stock_id = s.id AND current_price IS NOT NULL
        ORDER BY last_trade_date DESC NULLS LAST LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT completed_at FROM sync_logs
        WHERE stock_id = s.id AND status IN ('SUCCESS','PARTIAL')
        ORDER BY started_at DESC LIMIT 1
      ) sl ON true
      WHERE s.symbol ILIKE ${'%' + term + '%'}
         OR s.company_name ILIKE ${'%' + term + '%'}
         OR similarity(s.symbol, ${term}) > 0.2
         OR similarity(coalesce(s.company_name,''), ${term}) > 0.2
      ORDER BY (s.symbol = ${term.toUpperCase()}) DESC,
               GREATEST(similarity(s.symbol, ${term}),
                        similarity(coalesce(s.company_name,''), ${term})) DESC
      LIMIT ${limit}
    `);
    return rows.map(toListItem);
  }
}

export const stockRepository = new StockRepository();
