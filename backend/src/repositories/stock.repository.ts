import { Prisma, Stock } from '@prisma/client';
import { prisma } from '../database/prisma';

export interface StockListItem {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  currentPrice: number | null;
  changePercent: number | null;
  /** 52-week range (#25); null when the company page carried no such block. */
  week52High: number | null;
  week52Low: number | null;
  lastTradeDate: Date | null;
  lastSyncedAt: Date | null;
}

export class StockRepository {
  findBySymbol(symbol: string): Promise<Stock | null> {
    return prisma.stock.findUnique({ where: { symbol: symbol.toUpperCase() } });
  }

  async list(limit: number, offset: number): Promise<{ items: StockListItem[]; total: number }> {
    const [rows, total] = await Promise.all([
      prisma.stock.findMany({
        skip: offset,
        take: limit,
        orderBy: { symbol: 'asc' },
        include: {
          prices: { orderBy: { lastTradeDate: 'desc' }, take: 1 },
          syncLogs: { orderBy: { startedAt: 'desc' }, take: 1 },
        },
      }),
      prisma.stock.count(),
    ]);
    const items: StockListItem[] = rows.map((s) => ({
      id: s.id,
      symbol: s.symbol,
      companyName: s.companyName,
      sector: s.sector,
      currentPrice: s.prices[0]?.currentPrice ? Number(s.prices[0].currentPrice) : null,
      changePercent: s.prices[0]?.changePercent ? Number(s.prices[0].changePercent) : null,
      week52High: s.prices[0]?.week52High ? Number(s.prices[0].week52High) : null,
      week52Low: s.prices[0]?.week52Low ? Number(s.prices[0].week52Low) : null,
      lastTradeDate: s.prices[0]?.lastTradeDate ?? null,
      lastSyncedAt: s.syncLogs[0]?.completedAt ?? null,
    }));
    return { items, total };
  }

  create(symbol: string): Promise<Stock> {
    return prisma.stock.create({ data: { symbol: symbol.toUpperCase() } });
  }

  async delete(symbol: string): Promise<void> {
    await prisma.stock.delete({ where: { symbol: symbol.toUpperCase() } });
  }

  async findAllSymbols(): Promise<string[]> {
    const rows = await prisma.stock.findMany({ select: { symbol: true } });
    return rows.map((r) => r.symbol);
  }

  /** Trigram fuzzy search on symbol/company, ranked by similarity (exact symbol first). */
  async search(q: string, limit: number): Promise<StockListItem[]> {
    const term = q.trim();
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        symbol: string;
        company_name: string | null;
        sector: string | null;
        current_price: Prisma.Decimal | null;
        change_percent: Prisma.Decimal | null;
        week52_high: Prisma.Decimal | null;
        week52_low: Prisma.Decimal | null;
        last_trade_date: Date | null;
        last_synced_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT s.id, s.symbol, s.company_name, s.sector,
             p.current_price, p.change_percent, p.week52_high, p.week52_low, p.last_trade_date,
             sl.completed_at AS last_synced_at
      FROM stocks s
      LEFT JOIN LATERAL (
        SELECT current_price, change_percent, week52_high, week52_low, last_trade_date
        FROM stock_prices WHERE stock_id = s.id
        ORDER BY last_trade_date DESC NULLS LAST LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT completed_at FROM sync_logs
        WHERE stock_id = s.id AND status IN ('SUCCESS','PARTIAL')
        ORDER BY started_at DESC LIMIT 1
      ) sl ON true
      WHERE s.symbol ILIKE ${'%' + term + '%'}
         OR s.company_name ILIKE ${'%' + term + '%'}
         OR similarity(s.symbol, ${term}) > 0.2
         OR similarity(coalesce(s.company_name,''), ${term}) > 0.2
      ORDER BY (s.symbol = ${term.toUpperCase()}) DESC,
               GREATEST(similarity(s.symbol, ${term}),
                        similarity(coalesce(s.company_name,''), ${term})) DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      companyName: r.company_name,
      sector: r.sector,
      currentPrice: r.current_price ? Number(r.current_price) : null,
      changePercent: r.change_percent ? Number(r.change_percent) : null,
      week52High: r.week52_high ? Number(r.week52_high) : null,
      week52Low: r.week52_low ? Number(r.week52_low) : null,
      lastTradeDate: r.last_trade_date,
      lastSyncedAt: r.last_synced_at,
    }));
  }
}

export const stockRepository = new StockRepository();
