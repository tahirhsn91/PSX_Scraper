import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import type { PriceDTO, ScrapeResult } from '../types/dto';

const dec = (v: number | null | undefined): Prisma.Decimal | null =>
  v === null || v === undefined ? null : new Prisma.Decimal(v);
const date = (v: string | null | undefined): Date | null => (v ? new Date(v) : null);

/**
 * Whether a scraped price block is worth persisting at all.
 *
 * The company-page scrape merges several providers and can come back with a price object
 * whose every field is null (the page rendered without its quote block, one provider timed
 * out). Persisting that wrote an all-null `stock_prices` row which, being the newest, then
 * shadowed the last good reading — 9 of 23 symbols served `currentPrice: null` while their
 * syncs were logged SUCCESS. A block with no current price is treated as "no reading".
 */
export function hasUsablePrice(price: PriceDTO | null): price is PriceDTO {
  return price !== null && price.currentPrice !== null;
}

/**
 * Persist a validated ScrapeResult in a single transaction.
 * Idempotent via the composite unique constraints defined in the schema.
 * Returns the stock id.
 */
export async function persistScrapeResult(result: ScrapeResult): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.upsert({
      where: { symbol: result.symbol.toUpperCase() },
      update: {
        companyName: result.companyName ?? undefined,
        sector: result.sector ?? undefined,
      },
      create: {
        symbol: result.symbol.toUpperCase(),
        companyName: result.companyName,
        sector: result.sector,
      },
    });

    if (hasUsablePrice(result.price) && result.price.lastTradeDate) {
      await tx.stockPrice.upsert({
        where: {
          stockId_lastTradeDate: {
            stockId: stock.id,
            lastTradeDate: new Date(result.price.lastTradeDate),
          },
        },
        update: {
          currentPrice: dec(result.price.currentPrice),
          change: dec(result.price.change),
          changePercent: dec(result.price.changePercent),
          volume: result.price.volume ? BigInt(Math.trunc(result.price.volume)) : null,
          high: dec(result.price.high),
          low: dec(result.price.low),
          open: dec(result.price.open),
          close: dec(result.price.close),
          // Same rule as the 52-week range below, and it matters more: PSX's company page is
          // refused at the edge, so this run's marketCap is null for every symbol — writing that
          // would blank the value the market-cap refresh just fetched, and the column would flip
          // back to a dash on every sync. `undefined` drops the column from the UPDATE, so only a
          // real reading ever overwrites one.
          marketCap: dec(result.price.marketCap) ?? undefined,
          // 52-week range (#25). `?? undefined` leaves the stored value alone when this run
          // had no such block: a partial page parse must not blank a dashboard column.
          week52High: dec(result.price.week52High) ?? undefined,
          week52Low: dec(result.price.week52Low) ?? undefined,
        },
        create: {
          stockId: stock.id,
          currentPrice: dec(result.price.currentPrice),
          change: dec(result.price.change),
          changePercent: dec(result.price.changePercent),
          volume: result.price.volume ? BigInt(Math.trunc(result.price.volume)) : null,
          high: dec(result.price.high),
          low: dec(result.price.low),
          open: dec(result.price.open),
          close: dec(result.price.close),
          marketCap: dec(result.price.marketCap),
          week52High: dec(result.price.week52High),
          week52Low: dec(result.price.week52Low),
          lastTradeDate: new Date(result.price.lastTradeDate),
        },
      });
    }

    for (const f of result.financials) {
      await tx.financial.upsert({
        where: { stockId_year_quarter: { stockId: stock.id, year: f.year, quarter: f.quarter ?? 0 } },
        update: {
          eps: dec(f.eps), sales: dec(f.sales), profitAfterTax: dec(f.profitAfterTax),
          assets: dec(f.assets), liabilities: dec(f.liabilities), equity: dec(f.equity),
        },
        create: {
          stockId: stock.id, year: f.year, quarter: f.quarter,
          eps: dec(f.eps), sales: dec(f.sales), profitAfterTax: dec(f.profitAfterTax),
          assets: dec(f.assets), liabilities: dec(f.liabilities), equity: dec(f.equity),
        },
      });
    }

    for (const d of result.dividends) {
      if (!d.announcementDate) continue;
      await tx.dividend.upsert({
        where: {
          stockId_announcementDate: { stockId: stock.id, announcementDate: new Date(d.announcementDate) },
        },
        update: {
          bookClosure: date(d.bookClosure), paymentDate: date(d.paymentDate), dividend: dec(d.dividend),
        },
        create: {
          stockId: stock.id, announcementDate: new Date(d.announcementDate),
          bookClosure: date(d.bookClosure), paymentDate: date(d.paymentDate), dividend: dec(d.dividend),
        },
      });
    }

    if (result.ratios) {
      const values = [
        result.ratios.peRatio, result.ratios.pbRatio, result.ratios.roe, result.ratios.roa,
        result.ratios.dividendYield, result.ratios.bookValue, result.ratios.eps, result.ratios.beta,
      ];
      // A ratio row with nothing in it is not a reading, and writing one is worse than useless:
      // the detail read path serves the *newest* ratio row, so an all-null row shadows the real
      // figures an earlier sync stored and the card goes back to dashes while the sync logs
      // SUCCESS. That is exactly how `ratios` reached 64,709 rows with `pe_ratio` populated in
      // none of them. When there is nothing to write, the previous row stays the newest.
      if (values.some((v) => v !== null && v !== undefined)) {
        await tx.ratio.create({
          data: {
            stockId: stock.id,
            peRatio: dec(result.ratios.peRatio), pbRatio: dec(result.ratios.pbRatio),
            roe: dec(result.ratios.roe), roa: dec(result.ratios.roa),
            dividendYield: dec(result.ratios.dividendYield),
            // Book value per share (#79): read from the source's own ratio series, never derived
            // from price / (price-to-book) and never carried over from an earlier sync.
            bookValue: dec(result.ratios.bookValue),
            // Earnings per share, from the source's snapshot (migration 0012). Absent reads null.
            eps: dec(result.ratios.eps),
            beta: dec(result.ratios.beta),
          },
        });
      }
    }

    return stock.id;
  });
}
