import { prisma } from '../database/prisma';

/**
 * One session of a beta window: the index's close for that session and, when the symbol has one,
 * the symbol's own.
 *
 * A null `stockClose` is the "aligned days only" rule expressed in the row itself: the session
 * exists on the exchange's calendar but this symbol has no close for it, so no return is taken
 * across it — never a value carried forward from a neighbouring day (#79 criterion 7).
 */
export interface BetaSeriesRow {
  /** Exchange session day, `YYYY-MM-DD` (Karachi calendar, hence the +5h in the query). */
  day: string;
  stockClose: number | null;
  indexClose: number | null;
}

/**
 * The newest `sessions + 1` KSE-100 sessions, each with the symbol's own close for that day.
 *
 * Three rules live in this query, and all three are the repo's existing conventions rather than
 * new ones:
 *
 *  - **The session day is the exchange's day.** `trade_date + 5 hours` is the same derivation
 *    `candleDay()` uses (Pakistan is UTC+5 with no DST): rows are normally stamped 16:00 PKT
 *    (11:00 UTC), but legacy rows carry whatever time they were read, and a reading taken late
 *    in the UTC evening belongs to the next Karachi date. Grouping by the raw timestamp would
 *    file those sessions on the wrong day and split one session into several.
 *  - **One row per session, newest wins.** Both series hold several rows for a day (index
 *    readings were re-taken at 11:15/12:15/…; a stock day can hold a session-marker row and
 *    quote-poll rows). `DISTINCT ON (day) … ORDER BY day DESC, trade_date DESC` takes the newest
 *    reading of the day, which is the rule `toIndexCandles` and `buildCandles` already apply.
 *  - **The symbol's own close, from a row that carries one.** Intraday quote rows write
 *    `current_price` with no `close`, so requiring `close IS NOT NULL` keeps a session whose
 *    close is not known yet out of the window instead of measuring a morning reading as one.
 *
 * The window is expressed in *sessions*, not calendar days: 250 KSE-100 sessions is about one
 * trading year, and a symbol that was suspended for a month must not silently buy a wider window.
 */
export async function fetchBetaSeries(
  symbol: string,
  sessions: number,
  indexSymbol: string,
): Promise<BetaSeriesRow[]> {
  // 250 sessions of returns need 251 closes; bind the limit as an int (Postgres refuses a double
  // in LIMIT) and keep it inside a sane band regardless of what a caller passes.
  const take = Math.max(2, Math.min(5000, Math.trunc(sessions) + 1));

  return prisma.$queryRaw<BetaSeriesRow[]>`
    WITH day_rows AS (
      SELECT DISTINCT ON ((iv.trade_date + interval '5 hours')::date)
             (iv.trade_date + interval '5 hours')::date AS day,
             iv.value AS index_close
      FROM index_values iv
      JOIN market_indices mi ON mi.id = iv.index_id
      WHERE mi.symbol = ${indexSymbol}
      ORDER BY (iv.trade_date + interval '5 hours')::date DESC, iv.trade_date DESC
    ),
    window_rows AS (
      SELECT day, index_close FROM day_rows ORDER BY day DESC LIMIT ${take}::int
    ),
    stock AS (
      SELECT id FROM stocks WHERE symbol = ${symbol} LIMIT 1
    )
    SELECT to_char(w.day, 'YYYY-MM-DD') AS day,
           px.close::float8 AS "stockClose",
           w.index_close::float8 AS "indexClose"
    FROM window_rows w
    LEFT JOIN stock st ON true
    LEFT JOIN LATERAL (
      -- The day is compared as a *timestamp range* on the raw column rather than by wrapping it in
      -- (last_trade_date + 5h)::date = day: the two are equivalent, but a function on the column
      -- cannot use the (stock_id, last_trade_date DESC) index. Measured on the dev stack, the
      -- wrapped form re-read the symbol's whole 2,649-row history once per day: 1,006 ms for one
      -- symbol's window, a 6m26s full refresh. This form is a range scan per day, a handful of
      -- rows each — the same window executes in ~10 ms.
      SELECT sp.close
      FROM stock_prices sp
      WHERE sp.stock_id = st.id
        AND sp.close IS NOT NULL
        AND sp.last_trade_date >= (w.day::timestamp - interval '5 hours')
        AND sp.last_trade_date < ((w.day + 1)::timestamp - interval '5 hours')
      ORDER BY sp.last_trade_date DESC
      LIMIT 1
    ) px ON true
    ORDER BY w.day ASC
  `;
}

export type BetaWriteOutcome = 'updated' | 'created' | 'skipped';

/**
 * Write a computed beta into the `ratios.beta` column (#79).
 *
 * The newest ratio row is updated in place rather than a new row appended: the detail read path
 * serves the newest ratio row, so appending a row that carries only beta would shadow the P/E,
 * P/B and book value an earlier sync stored — the exact failure that once left `ratios` with
 * 64,709 rows and no `pe_ratio` in any of them. When the symbol has no ratio row at all, one is
 * created (an all-null row would not be a reading, but a row holding a computed beta is).
 *
 * A null is written rather than skipped when the computation says the symbol is below the
 * minimum: this is the only writer of this column, so "we could not compute one" must be
 * readable — leaving a figure from a window that no longer exists would be the stale value the
 * dash exists to prevent.
 */
export async function recordBeta(symbol: string, beta: number | null): Promise<BetaWriteOutcome> {
  const stock = await prisma.stock.findUnique({
    where: { symbol: symbol.toUpperCase() },
    select: { id: true },
  });
  if (!stock) return 'skipped';

  const newest = await prisma.ratio.findFirst({
    where: { stockId: stock.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (newest) {
    await prisma.ratio.update({ where: { id: newest.id }, data: { beta } });
    return 'updated';
  }
  // No ratio row yet: beta alone is a real reading, so it gets a row.
  if (beta === null) return 'skipped';
  await prisma.ratio.create({ data: { stockId: stock.id, beta } });
  return 'created';
}
