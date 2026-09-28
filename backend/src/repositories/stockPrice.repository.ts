import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import type { QuoteSnapshot } from '../scrapers/psxQuotes.scraper';

const dec = (v: number | null): Prisma.Decimal | null => (v === null ? null : new Prisma.Decimal(v));

/**
 * Upsert one live quote onto the row for the session it belongs to.
 *
 * Two deliberate choices, both fixes for how the company-page sync used to write prices:
 *
 *  - `lastTradeDate` is the session stamp taken from the series, not the wall clock, so
 *    every tick of the same session updates ONE row. Keying on the scrape instant instead
 *    appended a row per run (OGDC had 277) and made "the newest row" mean "the most recent
 *    run" rather than "the newest trade".
 *  - only the fields this source actually owns are written: price / close / change /
 *    changePercent / open / volume. `high` / `low` / `marketCap` belong to the company-page
 *    scrape and are left untouched.
 *
 * Returns `false` (writing nothing) when the symbol is not tracked.
 */
/**
 * Close of the most recent session before `before` — the figure a scraped change% is checked
 * against. Prefers `close`, falling back to `currentPrice` for rows a source filled in
 * partially.
 */
export async function previousCloseBefore(stockId: string, before: Date): Promise<number | null> {
  const row = await prisma.stockPrice.findFirst({
    where: { stockId, lastTradeDate: { lt: before } },
    orderBy: { lastTradeDate: 'desc' },
    select: { close: true, currentPrice: true },
  });
  const value = row?.close ?? row?.currentPrice ?? null;
  return value === null ? null : Number(value);
}

/** The symbol's recent session volumes, newest first. */
export async function recentVolumes(stockId: string, limit = 20): Promise<number[]> {
  const rows = await prisma.stockPrice.findMany({
    where: { stockId, volume: { not: null } },
    orderBy: { lastTradeDate: 'desc' },
    take: limit,
    select: { volume: true },
  });
  return rows.map((r) => Number(r.volume)).filter((v) => Number.isFinite(v));
}

/**
 * Median of a sample, or null when there is too little history to call anything abnormal.
 * Requires at least 3 readings: with one or two, a normal spike would look like corruption.
 */
export function median(values: number[]): number | null {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Tracked symbols with the row for `tradeDate` and the live price on it.
 *
 * The candle sync needs both halves in one read: a symbol with no row for the session has nothing to
 * write a candle onto (the quote poll creates those rows; this source only fills them in), and the
 * live price is the reference a candle's close is checked against before any of it is trusted.
 */
export async function listTrackedWithSessionRow(tradeDate: Date): Promise<{
  tracked: number;
  rows: Array<{ id: string; symbol: string; currentPrice: number | null }>;
}> {
  // `stocks` holds the tracked universe: deleting a symbol removes the row, so there is no second
  // flag to filter on. `tracked` is reported alongside the rows so the caller can say how many
  // symbols had no row for this session rather than silently syncing a subset.
  const tracked = await prisma.stock.count();
  const prices = await prisma.stockPrice.findMany({
    where: { lastTradeDate: tradeDate },
    select: { stockId: true, currentPrice: true, close: true, stock: { select: { symbol: true } } },
  });
  return {
    tracked,
    rows: prices.map((price) => {
      const reference = price.currentPrice ?? price.close ?? null;
      return {
        id: price.stockId,
        symbol: price.stock.symbol,
        currentPrice: reference === null ? null : Number(reference),
      };
    }),
  };
}

/**
 * The session's open and close from a source that publishes the candle.
 *
 * Writes only the fields this source owns, and only when it has a reading: `open` and `close`. `high`,
 * `low` and `marketCap` belong to the company-page scrape and the live `currentPrice` to the quote
 * poll — both are left exactly as they are. A null leg is not written at all, so a source that stops
 * answering cannot blank a good row (the rule `upsertQuoteSnapshot` documents). Returns false when the
 * session has no row, matching `IndexRepository.setSessionOpen`.
 */
export async function setSessionCandle(
  stockId: string,
  tradeDate: Date,
  candle: { open: number | null; close: number | null },
): Promise<boolean> {
  const data: Prisma.StockPriceUpdateManyMutationInput = {};
  if (candle.open !== null) data.open = new Prisma.Decimal(candle.open);
  if (candle.close !== null) data.close = new Prisma.Decimal(candle.close);
  if (Object.keys(data).length === 0) return false;
  const result = await prisma.stockPrice.updateMany({ where: { stockId, lastTradeDate: tradeDate }, data });
  return result.count > 0;
}

export async function upsertQuoteSnapshot(snapshot: QuoteSnapshot): Promise<boolean> {
  const stock = await prisma.stock.findUnique({
    where: { symbol: snapshot.symbol.toUpperCase() },
    select: { id: true },
  });
  if (!stock) return false;

  const data = {
    currentPrice: dec(snapshot.price),
    close: dec(snapshot.price),
    change: dec(snapshot.change),
    changePercent: dec(snapshot.changePercent),
    // A source that does not carry `open` (the market-wide ticker) must leave a stored one
    // alone rather than blank it — `undefined` drops the column from the UPDATE, `null` would
    // erase a real reading the company-page scrape had already written for this session.
    open: snapshot.open === null ? undefined : dec(snapshot.open),
    // Same rule for the day range: only a source that actually states one may update it.
    high: snapshot.high == null ? undefined : dec(snapshot.high),
    low: snapshot.low == null ? undefined : dec(snapshot.low),
    volume: snapshot.volume === null ? null : BigInt(Math.trunc(snapshot.volume)),
  };

  await prisma.stockPrice.upsert({
    where: {
      stockId_lastTradeDate: { stockId: stock.id, lastTradeDate: snapshot.sessionDate },
    },
    update: data,
    create: { stockId: stock.id, lastTradeDate: snapshot.sessionDate, ...data },
  });
  return true;
}
