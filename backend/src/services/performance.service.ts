import { prisma } from '../database/prisma';
import { stockService } from './stock.service';
import { RETURN_SESSIONS, type ReturnPeriod } from '../repositories/stock.repository';
import { actionsFor, actionFactor, factorAt } from './corporateActions.service';
import { NotFoundError } from '../types/errors';

/**
 * Period returns and an index comparison for one symbol.
 *
 * Three rules shape this file:
 *
 * 1. **The windows are counted in sessions**, one per trading date — a day with several sync
 *    snapshots is one session, not three. The screener counts them the same way, so the two agree
 *    on *when* a window starts and ends.
 * 2. **A return must survive a split.** Prices are stored as traded, so a 2-for-1 split prints as a
 *    50% fall. Every price below is multiplied by the factor of each confirmed split or bonus whose
 *    ex-date lies after it (`factorAt`), which is the same adjustment the chart applies — a return
 *    that says -50% where the holder lost nothing is not a return.
 * 3. **Price return is not total return.** A holder who kept the shares also collected the cash.
 *    `totalReturn` adds every dividend whose *ex-date* falls inside the window, converted into
 *    today's share terms with the same factors, and left un-reinvested. Dividends the register has
 *    not dated cannot be placed in a window; they are counted in `undatedDividends` rather than
 *    assumed to be nil.
 *
 * The comparison against an index is rebased — both legs start at 100 on the first session they
 * share — because an index at 166,000 next to a share at 517 would otherwise look like a cliff.
 */

const PERIODS: ReturnPeriod[] = ['1w', '1m', '3m', '6m', '1y'];
const MAX_SESSIONS = Math.max(...Object.values(RETURN_SESSIONS));

export interface PeriodReturn {
  period: ReturnPeriod;
  /** Sessions the window holds, and the sessions the symbol actually had (null = not enough). */
  sessions: number;
  available: number | null;
  /** Price return, split/bonus-adjusted, in percent. */
  value: number | null;
  /** Price return plus dividends that went ex- inside the window, in percent. */
  totalReturn: number | null;
  /** Dividends included in `totalReturn`, per share in today's split terms (0 when none). */
  dividends: number;
  /** True when a split or bonus inside the window moved the prices (so the raw series would lie). */
  adjusted: boolean;
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

interface SessionClose {
  date: string;
  close: number;
}

/** One close per session, newest first — several sync snapshots in a day are still one session. */
async function recentSessions(stockId: string, limit: number): Promise<SessionClose[]> {
  const rows = await prisma.$queryRaw<Array<{ d: Date; close: number }>>`
    SELECT d, close
    FROM (
      SELECT DISTINCT ON (last_trade_date::date)
        last_trade_date::date AS d, close
      FROM stock_prices
      WHERE stock_id = ${stockId} AND close IS NOT NULL
      ORDER BY last_trade_date::date DESC, last_trade_date DESC
    ) per_day
    ORDER BY d DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({ date: iso(new Date(r.d)), close: Number(r.close) }));
}

/**
 * The five windows, each measured from the session N back to today's.
 *
 * A window of N sessions needs N+1 prices (the two ends). Prices are adjusted for every confirmed
 * split/bonus after them before anything is divided, and dividends go in on their ex-date, so
 * `totalReturn` is what a holder actually made: price change plus the cash that left the company.
 */
async function periodReturns(stockId: string): Promise<PeriodReturn[]> {
  const [sessions, actions, dividends] = await Promise.all([
    recentSessions(stockId, MAX_SESSIONS + 1),
    actionsFor(stockId),
    prisma.dividend.findMany({
      where: { stockId, dividend: { not: null } },
      select: { exDate: true, announcementDate: true, dividend: true },
    }),
  ]);

  const adjustedClose = (s: SessionClose) => s.close * factorAt(actions, s.date);
  const dated = dividends
    .filter((d) => d.exDate != null)
    .map((d) => ({
      exDate: iso(d.exDate as Date),
      amount: Number(d.dividend),
    }))
    .filter((d) => Number.isFinite(d.amount) && d.amount > 0);

  return PERIODS.map((period) => {
    const back = RETURN_SESSIONS[period];
    const start = sessions[back];
    const end = sessions[0];
    const available = Math.min(sessions.length, back + 1);

    if (!start || !end) {
      return { period, sessions: back, available, value: null, totalReturn: null, dividends: 0, adjusted: false };
    }

    const startAdj = adjustedClose(start);
    const endAdj = adjustedClose(end);
    if (!(startAdj > 0)) {
      return { period, sessions: back, available, value: null, totalReturn: null, dividends: 0, adjusted: false };
    }

    // A dividend earned before the window opened is not this window's return; one that goes ex- on
    // the first plotted session is, because the buyer of that session did not receive it.
    const cash = dated
      .filter((d) => d.exDate > start.date && d.exDate <= end.date)
      .reduce((sum, d) => sum + d.amount * factorAt(actions, d.exDate), 0);

    const value = (endAdj / startAdj - 1) * 100;
    const totalReturn = ((endAdj + cash) / startAdj - 1) * 100;
    return {
      period,
      sessions: back,
      available,
      value: Number(value.toFixed(4)),
      totalReturn: Number(totalReturn.toFixed(4)),
      dividends: Number(cash.toFixed(4)),
      adjusted: factorAt(actions, start.date) !== 1,
    };
  });
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
