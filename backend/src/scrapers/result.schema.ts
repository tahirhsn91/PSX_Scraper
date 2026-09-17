import { z } from 'zod';

const num = z.number().nullable();

export const scrapeResultSchema = z.object({
  symbol: z.string().min(1),
  companyName: z.string().nullable(),
  sector: z.string().nullable(),
  price: z
    .object({
      currentPrice: num, change: num, changePercent: num, volume: num,
      high: num, low: num, open: num, close: num, marketCap: num,
      week52High: num, week52Low: num,
      lastTradeDate: z.string().nullable(),
    })
    .nullable(),
  dividends: z.array(
    z.object({
      announcementDate: z.string().nullable(), bookClosure: z.string().nullable(),
      paymentDate: z.string().nullable(), dividend: num,
    }),
  ),
  financials: z.array(
    z.object({
      year: z.number().int(), quarter: z.number().int().nullable(),
      eps: num, sales: num, profitAfterTax: num, assets: num, liabilities: num, equity: num,
    }),
  ),
  ratios: z
    .object({ peRatio: num, pbRatio: num, roe: num, roa: num, dividendYield: num, beta: num })
    .nullable(),
});
