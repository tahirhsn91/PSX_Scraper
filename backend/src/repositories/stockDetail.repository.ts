import { prisma } from '../database/prisma';

/** Aggregate read model for the stock detail page. */
export async function getStockDetail(symbol: string) {
  const stock = await prisma.stock.findUnique({
    where: { symbol: symbol.toUpperCase() },
    include: {
      // A price row with no price is not a reading — see hasUsablePrice().
      prices: {
        where: { currentPrice: { not: null } },
        orderBy: { lastTradeDate: 'desc' },
        take: 1,
      },
      ratios: { orderBy: { createdAt: 'desc' }, take: 1 },
      financials: { orderBy: [{ year: 'desc' }, { quarter: 'desc' }] },
      incomeStatements: { orderBy: { position: 'asc' } },
      dividends: { orderBy: { announcementDate: 'desc' } },
      syncLogs: { orderBy: { startedAt: 'desc' }, take: 1 },
      // Which of the indices we track list this stock (#174), so the stock page can link to each
      // index page. Read live from `index_constituents` rather than a column on `stocks`, so an
      // index rebalance is reflected on the next request. Ordered by index symbol to keep the list
      // — and therefore the page — stable between reads.
      constituents: {
        orderBy: { index: { symbol: 'asc' } },
        select: { index: { select: { symbol: true } } },
      },
    },
  });
  return stock;
}

export async function getPriceHistory(
  symbol: string,
  from: Date | undefined,
  to: Date | undefined,
) {
  const stock = await prisma.stock.findUnique({ where: { symbol: symbol.toUpperCase() }, select: { id: true } });
  if (!stock) return null;
  const where = {
    stockId: stock.id,
    ...(from || to ? { lastTradeDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  // Every reading, oldest first. The unique index is on (stock_id, last_trade_date), so a session
  // that was polled more than once is stored under several timestamps and arrives here several
  // times — `sessionise` below is what turns them back into one day per session.
  const items = await prisma.stockPrice.findMany({ where, orderBy: { lastTradeDate: 'asc' } });
  return { items };
}

/** One stored reading, as far as a session series cares. */
export interface PriceReading {
  lastTradeDate: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  currentPrice: number | null;
  volume: number | null;
}

/**
 * Collapse the readings of a window into one row per session.
 *
 * A session is polled repeatedly and each poll is a row, so `2026-09-15` can be 25 rows for one
 * stock. Charts and returns are per session: a repeated x value on a point axis breaks the line's
 * domain (the plot stopped weeks before the last trade day) and triple-counts a day in any average.
 * Readings arrive oldest first, so the freshest value wins per field while a null never overwrites a
 * value an earlier reading carried — the same rule `buildCandles` merges by.
 */
export function sessionise(rows: Array<{
  lastTradeDate: Date | null;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  currentPrice: unknown;
  volume: bigint | number | null;
}>): PriceReading[] {
  const byDay = new Map<string, PriceReading>();
  for (const r of rows) {
    if (!r.lastTradeDate) continue;
    const day = candleDay(r.lastTradeDate);
    const prev = byDay.get(day);
    const close = toNum(r.close) ?? toNum(r.currentPrice);
    byDay.set(day, {
      lastTradeDate: r.lastTradeDate,
      open: toNum(r.open) ?? prev?.open ?? null,
      high: toNum(r.high) ?? prev?.high ?? null,
      low: toNum(r.low) ?? prev?.low ?? null,
      close: close ?? prev?.close ?? null,
      currentPrice: toNum(r.currentPrice) ?? prev?.currentPrice ?? null,
      volume: r.volume == null ? prev?.volume ?? null : Number(r.volume),
    });
  }
  return [...byDay.values()].sort((a, b) => b.lastTradeDate.getTime() - a.lastTradeDate.getTime());
}

/** One daily candle, in the shape a candlestick chart wants. */
export interface Candle {
  /** Exchange session day, `YYYY-MM-DD`. */
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

function toNum(v: unknown): number | null {
  return v == null ? null : Number(v);
}

/**
 * The session day a reading belongs to.
 *
 * Derived from the *exchange's* calendar day, not the server's or UTC's: rows are normally
 * stamped 16:00 PKT (11:00 UTC) by `sessionStamp`, but legacy rows carry whatever time they
 * were read, and a reading taken after 19:00 UTC belongs to the next Karachi date. Pakistan
 * has no DST, so a flat +5h is exact.
 */
export function candleDay(stamp: Date): string {
  return new Date(stamp.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * A stored price row as a candle.
 *
 * `close` falls back to `currentPrice`: a live quote poll writes the traded price without a
 * session close, and that reading *is* the close of the day it was taken. Returns null when
 * neither exists — a candle with no price would be invented, and the chart must show a gap
 * instead. `high`/`low` stay null when the source gave none rather than being replaced by the
 * close; the renderer decides how to draw that.
 */
export function toCandle(row: {
  lastTradeDate: Date | null;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  currentPrice: unknown;
  volume: bigint | number | null;
}): Candle | null {
  const close = toNum(row.close) ?? toNum(row.currentPrice);
  // No price, or no stamp: a candle needs both a value and a session day, and inventing
  // either would put a fabricated bar on the chart.
  if (close === null || row.lastTradeDate === null) return null;
  return {
    time: candleDay(row.lastTradeDate),
    open: toNum(row.open),
    high: toNum(row.high),
    low: toNum(row.low),
    close,
    volume: row.volume == null ? null : Number(row.volume),
  };
}

/** A reading that belongs to a session, before merging. */
interface CandlePart extends Candle {}

/**
 * Build daily candles from every row a symbol has.
 *
 * A session is often covered by more than one reading, and the sources are complementary: the
 * historical EOD path gives open + close + volume with no high/low, while the live quote gives
 * high/low + close + volume with no open. So fields are merged across a session, each one taken
 * from the *newest reading that carries it* — the same "freshest wins" rule the rest of the app
 * uses, and never a value invented to fill a gap.
 *
 * Readings that cannot belong to this symbol are dropped. Real examples from the dev database:
 * FFC's 16 Sep session holds 21 rows and 15 Sep holds 26, several of them carrying index levels
 * (~48,131) rather than a share price (~530) — rows the index history wrote against a stock id.
 * A wrong candle is worse than a missing one, so they are filtered against the symbol's own
 * median close, which is robust to exactly this kind of outlier. Each drop is counted and
 * reported, never silently swallowed.
 */
export function buildCandles(parts: Candle[]): {
  items: Candle[];
  skipped: number;
  sanitised: number;
} {
  if (parts.length === 0) return { items: [], skipped: 0, sanitised: 0 };

  // Group by session first: every plausibility judgement below is made *within* a day.
  const byDay = new Map<string, Candle[]>();
  for (const p of parts) {
    const group = byDay.get(p.time);
    if (group) group.push(p);
    else byDay.set(p.time, [p]);
  }

  const items: Candle[] = [];
  let skipped = 0;
  let sanitised = 0;

  for (const [day, group] of byDay) {
    // The baseline is the session's own readings, never the symbol's whole history. A
    // whole-history median looks reasonable and is badly wrong: on any stock whose price
    // multiplied over the years, the early sessions sit far below the median and get deleted as
    // "impossible" — 42 symbols lost up to 700 sessions of real history that way. Within a
    // single day there is no trend to confuse the test, and the contamination this guards
    // against (an index level written into a share's rows, ~100x out) is a same-day artefact.
    const closes = group.map((g) => g.close).sort((a, b) => a - b);
    // Lower middle value, deliberately: with an even number of readings the two middles
    // straddle the truth when one is contamination, and contamination runs *high* — an index
    // level sits above a share price, not below it. Picking the upper middle would keep the
    // index level and discard the real price.
    const median = closes[Math.floor((closes.length - 1) / 2)]!;
    const floor = median / 10;
    const ceiling = median * 10;
    // With a single reading there is nothing to compare against, so it is taken as it stands —
    // inventing a verdict from a whole-history median is what deleted good data.
    const judgeable = group.length > 1;
    const sane = (v: number | null) => (v !== null && v >= floor && v <= ceiling ? v : null);

    let merged: Candle | null = null;
    // group is in insertion order, i.e. oldest reading first, so later writes are fresher.
    for (const p of group) {
      if (judgeable && (p.close < floor || p.close > ceiling)) {
        skipped += 1;
        continue;
      }
      // Field-wise too: contamination is not always the close. Dev holds an FFC row whose close
      // is plausible (~530) while its open and high are the index level (48,131), and another
      // whose low is 7. A field that cannot belong is treated as absent; the reading itself
      // usually still carries good values.
      const open = judgeable ? sane(p.open) : p.open;
      const high = judgeable ? sane(p.high) : p.high;
      const low = judgeable ? sane(p.low) : p.low;
      if (open !== p.open || high !== p.high || low !== p.low) sanitised += 1;
      const clean: Candle = { time: day, open, high, low, close: p.close, volume: p.volume };
      merged = merged ? mergeParts(merged, clean) : clean;
    }
    if (merged) items.push(merged);
  }

  return {
    items: items.sort((a, b) => a.time.localeCompare(b.time)),
    skipped,
    sanitised,
  };
}

/** Field-wise merge: keep what we have, take what the newer reading adds. */
function mergeParts(older: Candle, newer: Candle): Candle {
  return {
    time: newer.time,
    open: newer.open ?? older.open,
    high: newer.high ?? older.high,
    low: newer.low ?? older.low,
    close: newer.close,
    volume: newer.volume ?? older.volume,
  };
}

/** How many candles a single request may return — about 20 years of sessions. */
export const CANDLE_LIMIT = 5000;

/**
 * Daily candles for a tracked symbol, oldest first. No `from` means "everything we hold",
 * which is the chart's default: the earliest session on record up to today.
 */
export async function getCandles(
  symbol: string,
  from: Date | undefined,
  to: Date | undefined,
): Promise<{ items: Candle[]; skipped: number; sanitised: number } | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol: symbol.toUpperCase() },
    select: { id: true },
  });
  if (!stock) return null;
  const rows = await prisma.stockPrice.findMany({
    where: {
      stockId: stock.id,
      ...(from || to
        ? { lastTradeDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    orderBy: { lastTradeDate: 'asc' },
    take: CANDLE_LIMIT,
    select: {
      lastTradeDate: true, open: true, high: true, low: true, close: true,
      currentPrice: true, volume: true,
    },
  });
  const parts = rows.map(toCandle).filter((c): c is Candle => c !== null);
  return buildCandles(parts);
}
