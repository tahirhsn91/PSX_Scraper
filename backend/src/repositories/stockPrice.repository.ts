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
    open: dec(snapshot.open),
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
