import { scrapeResultSchema } from '../src/scrapers/result.schema';

describe('scrapeResultSchema', () => {
  it('accepts a well-formed merged result', () => {
    const ok = {
      symbol: 'FFC', companyName: 'Fauji', sector: 'Fertilizer',
      price: { currentPrice: 100, change: 1, changePercent: 1, volume: 1000, high: 101, low: 99, open: 99, close: 100, marketCap: 1e9, lastTradeDate: new Date().toISOString() },
      dividends: [], financials: [{ year: 2024, quarter: null, eps: 5, sales: null, profitAfterTax: null, assets: null, liabilities: null, equity: null }],
      ratios: { peRatio: 10, pbRatio: 2, roe: 20, roa: 10, dividendYield: 5, beta: 0.9 },
    };
    expect(() => scrapeResultSchema.parse(ok)).not.toThrow();
  });
  it('rejects a result missing required fields', () => {
    expect(() => scrapeResultSchema.parse({ symbol: 'X' })).toThrow();
  });
});
