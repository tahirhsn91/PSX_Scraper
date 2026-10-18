import { prisma } from '../database/prisma';
import { stockService } from './stock.service';
import { RETURN_SESSIONS, type ReturnPeriod } from '../repositories/stock.repository';
import { NotFoundError } from '../types/errors';

/**
 * Period returns and an index comparison for one symbol.
 *
 * Two rules shape this file:
 *
 * 1. **Returns are the screener's returns.** The windows come from `RETURN_SESSIONS` and are counted
 *    in *sessions*, one per trading date — a day with several sync snapshots is one session, not
 *    three. The screener's lateral applies the same rule, so a symbol showing +3.17% here shows
 *    +3.17% there for the same period.
 * 2. **A comparison is only honest when both legs are rebased.** The stock and the index start at
 *    100 on the first session they share, and the legend says so; plotting an index at 40,000 next
 *    to a share at 400 would draw a cliff that means nothing.
 */

const PERIODS: ReturnPeriod[] = ['1w', '1m', '3m', '6m', '1y'];

export interface PeriodReturn {
  period: ReturnPeriod;
  /** Sessions the window holds, and the sessions the symbol actually had (null = not enough). */
  sessions: number;
  available: number | null;
  value: number | null;
}

export interface BenchmarkPoint {
  date: string;
  stock: number;
  index: number;
}

export interface Performance {
  symbol: string;
  returns: PeriodReturn[];
  benchmark: {
    index: { symbol: string; name: string };
    base: 100;
    baseDate: string | null;
    points: BenchmarkPoint[];
    /** True when the index had no value on the base date and the previous session was used. */
    carried: boolean;
  } | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** All five windows in one statement, deduped to one price per session date. */
async function periodReturns(stockId: string): Promise<PeriodReturn[]> {
  const lateral = (back: number, idx: number) => {
    const col = `ret${idx}`;
    const avail = `avail${idx}`;
    return `
      LEFT JOIN LATERAL (
        WITH r AS (
          SELECT close, ROW_NUMBER() OVER (ORDER BY d DESC) AS rn
          FROM (
            SELECT DISTINCT ON (last_trade_date::date)
              last_trade_date::date AS d, close
            FROM stock_prices
            WHERE stock_id = $1 AND close IS NOT NULL
            ORDER BY last_trade_date::date DESC, last_trade_date DESC
          ) per_day
          ORDER BY d DESC
          LIMIT ${back}
        )
        SELECT
          (MAX(close) FILTER (WHERE rn = 1) / NULLIF(MAX(close) FILTER (WHERE rn = ${back}), 0) - 1) * 100 AS ${col},
          MAX(rn)::int AS ${avail}
        FROM r
      ) p${idx} ON TRUE`;
  };

  // `+ 1` is not an off-by-one: a return over N sessions needs N+1 prices (the two ends). The
  // screener's lateral builds the same window, which is what makes the two agree.
  const sql = `SELECT ${PERIODS.map((_, i) => `p${i}.ret${i} AS ret${i}, p${i}.avail${i} AS avail${i}`).join(', ')}
    FROM (SELECT 1) base ${PERIODS.map((p, i) => lateral(RETURN_SESSIONS[p] + 1, i)).join('\n')}`;

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, number | null>>>(sql, stockId);
  const row = rows[0] ?? {};
  return PERIODS.map((period, i) => ({
    period,
    sessions: RETURN_SESSIONS[period],
    available: (row[`avail${i}`] as number | null) ?? null,
    value: row[`ret${i}`] == null ? null : Number(row[`ret${i}`]),
  }));
}

/** The index's values by date, plus its name, or null when the index is unknown. */
async function indexSeries(symbol: string, from: Date) {
  const idx = await prisma.marketIndex.findUnique({ where: { symbol }, select: { id: true, name: true } });
  if (!idx) return null;
  const rows = await prisma.indexValue.findMany({
    where: { indexId: idx.id, tradeDate: { gte: from } },
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true, value: true },
  });
  return {
    symbol,
    name: idx.name ?? symbol,
    points: rows.map((r) => ({ date: iso(r.tradeDate), value: Number(r.value) })),
  };
}

export async function performance(symbol: string, range: '1W' | '1M' | '6M' | '1Y' | '3Y' | 'MAX', indexSymbol: string) {
  const detail = await prisma.stock.findUnique({ where: { symbol: symbol.toUpperCase() }, select: { id: true, symbol: true } });
  if (!detail) throw new NotFoundError(`Stock not tracked: ${symbol.toUpperCase()}`);

  const [returns, candles] = await Promise.all([
    periodReturns(detail.id),
    stockService.candles(detail.symbol, { range }),
  ]);

  const stockPoints: Array<{ date: string; value: number }> = candles.items.map((c) => ({
    date: c.time,
    value: c.close,
  }));
  const head = stockPoints[0];
  if (!head) {
    return { symbol: detail.symbol, returns, benchmark: null } as Performance;
  }

  const first = head.date;
  const idx = await indexSeries(indexSymbol.toUpperCase(), new Date(`${first}T00:00:00Z`));
  if (!idx || idx.points.length === 0) {
    return { symbol: detail.symbol, returns, benchmark: null } as Performance;
  }

  // Walk the stock's sessions and carry the last known index value forward: the index and the stock
  // can miss different sessions (a suspension, a late index print), and a gap would otherwise punch
  // a hole in the comparison.
  const byDate = new Map(idx.points.map((p) => [p.date, p.value]));
  let lastIndex: number | null = null;
  const stockBase = head.value;
  const aligned: BenchmarkPoint[] = [];
  let baseIndex: number | null = null;
  let carried = false;

  for (const p of stockPoints) {
    const exact = byDate.get(p.date);
    if (exact != null) lastIndex = exact;
    if (lastIndex == null) continue; // index has not opened before this session: nothing to compare
    if (baseIndex == null) {
      baseIndex = lastIndex;
      carried = exact == null;
    }
    aligned.push({
      date: p.date,
      stock: (p.value / stockBase) * 100,
      index: (lastIndex / baseIndex) * 100,
    });
  }

  return {
    symbol: detail.symbol,
    returns,
    benchmark: {
      index: { symbol: idx.symbol, name: idx.name },
      base: 100 as const,
      baseDate: aligned[0]?.date ?? null,
      points: aligned,
      carried,
    },
  } as Performance;
}
