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
  incomeStatement: z
    .object({
      periods: z.array(z.string()),
      lines: z.array(
        z.object({
          metricCode: z.string(),
          metricName: z.string(),
          values: z.record(z.string(), num),
        }),
      ),
    })
    .nullable(),
  ratios: z
    .object({
      peRatio: num, pbRatio: num, roe: num, roa: num, dividendYield: num,
      // Optional so a provider that has nothing to say about a field can leave the key out
      // instead of asserting a shape it does not fill.
      bookValue: num.optional(), eps: num.optional(), beta: num,
      netProfitMargin: num.optional(), freeFloatShares: num.optional(),
      freeFloatPercent: num.optional(), dps: num.optional(), payoutRatio: num.optional(),
      roic: num.optional(), debtToEquity: num.optional(), currentRatio: num.optional(),
      revenueGrowth: num.optional(), epsGrowth: num.optional(),
    })
    .nullable(),
});
