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
      dividends: { orderBy: { announcementDate: 'desc' } },
      syncLogs: { orderBy: { startedAt: 'desc' }, take: 1 },
    },
  });
  return stock;
}

export async function getPriceHistory(
  symbol: string,
  from: Date | undefined,
  to: Date | undefined,
  limit: number,
  offset: number,
) {
  const stock = await prisma.stock.findUnique({ where: { symbol: symbol.toUpperCase() }, select: { id: true } });
  if (!stock) return null;
  const where = {
    stockId: stock.id,
    ...(from || to ? { lastTradeDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.stockPrice.findMany({ where, orderBy: { lastTradeDate: 'desc' }, skip: offset, take: limit }),
    prisma.stockPrice.count({ where }),
  ]);
  return { items, total };
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

  const closes = parts.map((p) => p.close).sort((a, b) => a - b);
  const median = closes[Math.floor(closes.length / 2)]!;
  // A factor of 10 either side of the symbol's own median. Generous on purpose: a real price
  // must never be dropped, while an index level recorded against a share is ~100x out.
  const floor = median / 10;
  const ceiling = median * 10;
  const sane = (v: number | null) => (v !== null && v >= floor && v <= ceiling ? v : null);

  const byDay = new Map<string, Candle>();
  let skipped = 0;
  let sanitised = 0;
  // parts arrive oldest first, so later writes of the same day are the fresher readings.
  for (const p of parts) {
    if (p.close < floor || p.close > ceiling) {
      skipped += 1;
      continue;
    }
    // Field-wise too: the contamination is not always the close. Dev has an FFC row whose
    // close is plausible (~530) while its open and high are the index level (48,131), and
    // another whose low is 7. A field that cannot be that symbol's is treated as absent —
    // the reading itself usually still carries good values.
    const open = sane(p.open);
    const high = sane(p.high);
    const low = sane(p.low);
    if (open !== p.open || high !== p.high || low !== p.low) sanitised += 1;
    const clean: Candle = { time: p.time, open, high, low, close: p.close, volume: p.volume };
    const prev = byDay.get(p.time);
    byDay.set(p.time, prev ? mergeParts(prev, clean) : clean);
  }
  return {
    items: [...byDay.values()].sort((a, b) => a.time.localeCompare(b.time)),
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
