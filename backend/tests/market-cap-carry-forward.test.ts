/**
 * A stale market cap must never become a current one (#71).
 *
 * The 460 contaminated rows were nulled, but the carry-forward is what keeps the dashboard from
 * flickering, and it used to take the most recent non-null cap regardless of how old it was — so a
 * value read before the scoped-read fix could still be presented as the current figure. These tests
 * pin both directions of the rule the issue asked for, against the real query and a real database:
 *
 *  - a cap read before the fix is not carried onto a newer row that has none (the row keeps its
 *    dash), which is the half that was missing;
 *  - a cap read after the fix is still carried, so the rule does not undo the column's purpose.
 *
 * Both symbols are throwaway and every row they create is deleted in `afterAll`.
 */
import { prisma } from '../src/database/prisma';
import {
  carryForwardLatestMarketCaps,
  MARKET_CAP_TRUSTWORTHY_SINCE,
} from '../src/repositories/stock.repository';

/**
 * These tests run the real query, and it scans every price row to find each symbol's newest — about
 * a second on a warm dev database but well past jest's five-second default on a cold one.
 */
jest.setTimeout(60_000);

const STALE_SYMBOL = 'ZZCAPSTALE';
const FRESH_SYMBOL = 'ZZCAPFRESH';

/** A session before the scoped-read fix — the era whose reads must never resurface. */
const BEFORE_FIX = new Date('2026-09-14T11:00:00.000Z');
/** A session on the fix's own day, stamped 16:00 PKT like every session row. */
const ON_FIX_DAY = new Date('2026-09-25T11:00:00.000Z');
/** A later session whose row has no cap of its own — the row the carry-forward would fill. */
const LATER = new Date('2026-09-26T11:00:00.000Z');

/** The identical figure 127 symbols shared when the page-wide sweep was reading a container's text. */
const CONTAMINATED = 48131.13;

async function seedSymbol(symbol: string, seedDay: Date, cap: number): Promise<string> {
  const stock = await prisma.stock.upsert({
    where: { symbol },
    update: {},
    create: { symbol },
    select: { id: true },
  });
  await prisma.stockPrice.create({
    data: { stockId: stock.id, lastTradeDate: seedDay, close: 100, marketCap: cap },
  });
  await prisma.stockPrice.create({
    data: { stockId: stock.id, lastTradeDate: LATER, close: 101 },
  });
  return stock.id;
}

async function newestCap(stockId: string): Promise<number | null> {
  const row = await prisma.stockPrice.findFirst({
    where: { stockId },
    orderBy: { lastTradeDate: 'desc' },
    select: { marketCap: true },
  });
  return row?.marketCap == null ? null : Number(row.marketCap);
}

afterAll(async () => {
  await prisma.stockPrice.deleteMany({
    where: { stock: { symbol: { in: [STALE_SYMBOL, FRESH_SYMBOL] } } },
  });
  await prisma.stock.deleteMany({ where: { symbol: { in: [STALE_SYMBOL, FRESH_SYMBOL] } } });
  await prisma.$disconnect();
});

it('the cutoff is the scoped-read fix its own day, stated rather than implied', () => {
  expect(MARKET_CAP_TRUSTWORTHY_SINCE).toBe('2026-09-25');
});

it('refuses to carry a cap read before the scoped-read fix onto a newer row', async () => {
  const stockId = await seedSymbol(STALE_SYMBOL, BEFORE_FIX, CONTAMINATED);
  await carryForwardLatestMarketCaps();
  expect(await newestCap(stockId)).toBeNull();
});

it('still carries a cap read after the fix, so the rule does not empty the column', async () => {
  const stockId = await seedSymbol(FRESH_SYMBOL, ON_FIX_DAY, 1_540_000_000);
  await carryForwardLatestMarketCaps();
  expect(await newestCap(stockId)).toBe(1_540_000_000);
});
