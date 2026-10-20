/**
 * A 52-week range must survive a session row that has none (#258).
 *
 * PSX publishes the range on the company page only, so the row the quote poll creates carries no
 * range until the company sync writes one. When that page is refused — it is refused for days at a
 * time — every stock's range blanked at once and all 511 dashboards read empty.
 *
 * These tests pin the stand-in against a real database, in both directions:
 *
 *  - a range published within the week still shows when the newest row has none;
 *  - a range older than that week does not: the column keeps its dash rather than presenting a
 *    figure that no longer describes the last twelve months.
 *
 * Every row these tests create is deleted in `afterAll`.
 */
import { prisma } from '../src/database/prisma';
import { stockRepository, WEEK52_FALLBACK_DAYS } from '../src/repositories/stock.repository';

jest.setTimeout(60_000);

const FRESH = 'ZZ52FRESH';
const STALE = 'ZZ52STALE';
const NONE = 'ZZ52NONE';
const SYMBOLS = [FRESH, STALE, NONE];

const DAY = 86_400_000;
const HIGH = 369.99;
const LOW = 235.55;

/** A session stamped 16:00 PKT, the way every stored session row is. */
function session(daysAgo: number): Date {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setUTCHours(11, 0, 0, 0);
  return d;
}

async function seed(symbol: string, published: { daysAgo: number; high: number; low: number } | null) {
  const stock = await prisma.stock.upsert({
    where: { symbol },
    update: {},
    create: { symbol, companyName: `${symbol} test` },
    select: { id: true },
  });
  if (published) {
    await prisma.stockPrice.create({
      data: {
        stockId: stock.id,
        currentPrice: 286.55,
        close: 286.55,
        week52High: published.high,
        week52Low: published.low,
        lastTradeDate: session(published.daysAgo),
      },
    });
  }
  // The newest session: a quote-poll row, with a price but no range of its own.
  await prisma.stockPrice.create({
    data: {
      stockId: stock.id,
      currentPrice: 287.1,
      close: 287.1,
      lastTradeDate: session(0),
    },
  });
  return stock.id;
}

beforeAll(async () => {
  await prisma.stock.deleteMany({ where: { symbol: { in: SYMBOLS } } });
  await seed(FRESH, { daysAgo: 3, high: HIGH, low: LOW });
  await seed(STALE, { daysAgo: WEEK52_FALLBACK_DAYS + 10, high: HIGH, low: LOW });
  await seed(NONE, null);
});

afterAll(async () => {
  await prisma.stock.deleteMany({ where: { symbol: { in: SYMBOLS } } });
  await prisma.$disconnect();
});

describe('52-week range fallback', () => {
  it('carries a range published inside the window onto a row that has none', async () => {
    const range = await stockRepository.latestWeek52Range(
      (await prisma.stock.findUniqueOrThrow({ where: { symbol: FRESH }, select: { id: true } })).id,
    );
    expect(range).toEqual({ high: HIGH, low: LOW });
  });

  it('refuses a range older than the window rather than show a stale figure', async () => {
    const stale = await prisma.stock.findUniqueOrThrow({ where: { symbol: STALE }, select: { id: true } });
    const none = await prisma.stock.findUniqueOrThrow({ where: { symbol: NONE }, select: { id: true } });
    expect(await stockRepository.latestWeek52Range(stale.id)).toBeNull();
    expect(await stockRepository.latestWeek52Range(none.id)).toBeNull();
  });

  it('serves the stand-in through search, which every stock row is rendered from', async () => {
    const rows = await stockRepository.search(FRESH, 5);
    const fresh = rows.find((r) => r.symbol === FRESH);
    expect(fresh?.week52High).toBe(HIGH);
    expect(fresh?.week52Low).toBe(LOW);

    const staleRows = await stockRepository.search(STALE, 5);
    const stale = staleRows.find((r) => r.symbol === STALE);
    expect(stale?.week52High).toBeNull();
    expect(stale?.week52Low).toBeNull();
  });

  it('serves the stand-in through the list, so the dashboard columns match', async () => {
    const { items } = await stockRepository.list(600, 0);
    const bySymbol = new Map(items.map((i) => [i.symbol, i]));
    expect(bySymbol.get(FRESH)?.week52High).toBe(HIGH);
    expect(bySymbol.get(FRESH)?.week52Low).toBe(LOW);
    expect(bySymbol.get(STALE)?.week52High).toBeNull();
    expect(bySymbol.get(NONE)?.week52High).toBeNull();
  });
});
