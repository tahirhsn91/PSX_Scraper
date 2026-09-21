import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { indexRepository } from '../repositories/index.repository';
import { fetchPsxIndices, fetchIndexNames } from '../scrapers/psxIndices.scraper';
import { sessionStamp } from '../scrapers/parse.utils';
import { childLogger } from '../utils/logger';

/**
 * Snapshot every index PSX publishes into `market_indices` + `index_values`.
 *
 * Runs off the exchange's own market-summary page (see `psxIndices.scraper.ts`), which is
 * reachable where `dps.psx.com.pk` is not. One page fetch covers the whole board, so this is
 * cheap enough to run on the same few-minute cadence as the quote poll.
 *
 * Writes are idempotent: the index row is upserted by symbol, and the day's value is upserted
 * on `(index_id, trade_date)` — so re-running within a session updates today's reading instead
 * of appending a second row for the same day, and no duplicate is ever created.
 *
 * The level is also the day's value: during a session the page shows the live index, which is
 * what the dashboard wants, and after the close it is the close. The summary endpoint derives
 * the change by comparing it with the previous session, so nothing is stored twice.
 */
export interface IndexScrapeResult {
  symbols: number;
  created: number;
  updated: number;
  valuesWritten: number;
  namesResolved: number;
}

export async function scrapeIndices(now = new Date()): Promise<IndexScrapeResult> {
  const log = childLogger({ op: 'index-scrape' });
  const parsed = await fetchPsxIndices();
  // Cosmetic only; an empty map means the symbol stays as the name.
  const names = await fetchIndexNames(parsed.map((i) => i.symbol));
  // The same session key the rest of the pipeline uses (16:00 PKT), so an index row lines up
  // with the stock rows for that day.
  const stamp = new Date(sessionStamp(now.toISOString())!);

  let created = 0;
  let updated = 0;
  let valuesWritten = 0;

  for (const index of parsed) {
    const existing = await prisma.marketIndex.findUnique({
      where: { symbol: index.symbol },
      select: { id: true, name: true },
    });
    // Keep a real description once we have one; only replace the placeholder (the bare symbol).
    const name =
      existing && existing.name && existing.name !== index.symbol ? existing.name : names[index.symbol] ?? index.symbol;

    const row = await prisma.marketIndex.upsert({
      where: { symbol: index.symbol },
      update: {
        name,
        liveValue: new Prisma.Decimal(index.level),
        liveAt: now,
        // The exchange's own change figures, carried through as published.
        liveChange: index.change === null ? null : new Prisma.Decimal(index.change),
        liveChangePercent: index.changePercent === null ? null : new Prisma.Decimal(index.changePercent),
        lastSyncedAt: now,
      },
      create: {
        symbol: index.symbol,
        name,
        liveValue: new Prisma.Decimal(index.level),
        liveAt: now,
        liveChange: index.change === null ? null : new Prisma.Decimal(index.change),
        liveChangePercent: index.changePercent === null ? null : new Prisma.Decimal(index.changePercent),
        lastSyncedAt: now,
      },
    });
    if (existing) updated += 1;
    else created += 1;

    valuesWritten += await indexRepository.upsertValues(row.id, [
      { date: stamp.toISOString(), close: index.level, open: null, volume: null },
    ]);
  }

  const result: IndexScrapeResult = {
    symbols: parsed.length,
    created,
    updated,
    valuesWritten,
    namesResolved: Object.keys(names).length,
  };
  log.info('index-scrape.done', { ...result, stamp: stamp.toISOString() });
  return result;
}
