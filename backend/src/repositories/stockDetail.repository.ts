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
