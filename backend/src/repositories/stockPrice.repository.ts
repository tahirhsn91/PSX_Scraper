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
