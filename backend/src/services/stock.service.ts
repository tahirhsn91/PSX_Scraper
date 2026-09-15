import { Prisma } from '@prisma/client';
import { stockRepository } from '../repositories/stock.repository';
import { getStockDetail, getPriceHistory } from '../repositories/stockDetail.repository';
import { enqueueSync } from '../jobs/queues';
import { ConflictError, NotFoundError } from '../types/errors';
import { rangeToFrom, HistoryRange } from '../utils/range';

const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

export const stockService = {
  async list(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const { items, total } = await stockRepository.list(limit, offset);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  },

  async getDetail(symbol: string) {
    const s = await getStockDetail(symbol);
    if (!s) throw new NotFoundError(`Stock not tracked: ${symbol.toUpperCase()}`);
    const price = s.prices[0];
    const ratio = s.ratios[0];
    return {
      id: s.id,
      symbol: s.symbol,
      companyName: s.companyName,
      sector: s.sector,
      price: price
        ? {
            currentPrice: num(price.currentPrice),
            change: num(price.change),
            changePercent: num(price.changePercent),
            volume: price.volume ? Number(price.volume) : null,
            high: num(price.high),
            low: num(price.low),
            open: num(price.open),
            close: num(price.close),
            marketCap: num(price.marketCap),
            week52High: num(price.week52High),
            week52Low: num(price.week52Low),
            lastTradeDate: price.lastTradeDate,
          }
        : null,
      ratios: ratio
        ? {
            peRatio: num(ratio.peRatio), pbRatio: num(ratio.pbRatio), roe: num(ratio.roe),
            roa: num(ratio.roa), dividendYield: num(ratio.dividendYield), beta: num(ratio.beta),
          }
        : null,
      financials: s.financials.map((f) => ({
        year: f.year, quarter: f.quarter, eps: num(f.eps), sales: num(f.sales),
        profitAfterTax: num(f.profitAfterTax), assets: num(f.assets),
        liabilities: num(f.liabilities), equity: num(f.equity),
      })),
      dividends: s.dividends.map((d) => ({
        announcementDate: d.announcementDate, bookClosure: d.bookClosure,
        paymentDate: d.paymentDate, dividend: num(d.dividend),
      })),
      lastSync: s.syncLogs[0]
        ? { status: s.syncLogs[0].status, completedAt: s.syncLogs[0].completedAt, startedAt: s.syncLogs[0].startedAt }
        : null,
    };
  },

  async add(symbol: string) {
    const sym = symbol.toUpperCase();
    const existing = await stockRepository.findBySymbol(sym);
    if (existing) throw new ConflictError(`Stock already tracked: ${sym}`);
    const stock = await stockRepository.create(sym);
    const job = await enqueueSync(sym, 'add');
    return { stock, jobId: job.id };
  },

  async remove(symbol: string) {
    const existing = await stockRepository.findBySymbol(symbol);
    if (!existing) throw new NotFoundError(`Stock not tracked: ${symbol.toUpperCase()}`);
    await stockRepository.delete(symbol);
  },

  async history(symbol: string, opts: { range?: HistoryRange; from?: Date; to?: Date; page?: number; limit?: number }) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 2000;
    // A range preset takes precedence over an explicit `from`.
    const from = opts.range ? rangeToFrom(opts.range) : opts.from;
    const offset = (page - 1) * limit;
    const res = await getPriceHistory(symbol, from, opts.to, limit, offset);
    if (res === null) throw new NotFoundError(`Stock not tracked: ${symbol.toUpperCase()}`);
    return {
      items: res.items.map((p) => ({
        currentPrice: num(p.currentPrice), open: num(p.open), high: num(p.high),
        low: num(p.low), close: num(p.close), volume: p.volume ? Number(p.volume) : null,
        lastTradeDate: p.lastTradeDate,
      })),
      page, limit, total: res.total, totalPages: Math.ceil(res.total / limit),
    };
  },
};
