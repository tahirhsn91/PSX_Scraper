import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { indexRepository } from '../repositories/index.repository';
import { fetchPsxIndices, fetchIndexNames } from '../scrapers/psxIndices.scraper';
import { sessionStamp } from '../scrapers/parse.utils';
import { isMarketOpen } from '../utils/marketHours';
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
 *
 * The day's opening level is captured here too, on the one reading that may be the session's
 * first — see `openingLevelFor`.
 */
export interface IndexScrapeResult {
  symbols: number;
  created: number;
  updated: number;
  valuesWritten: number;
  namesResolved: number;
}

/**
 * The window in which a reading may become the session's opening level, as minutes past midnight
 * PKT. 09:30 is the first trade of the session; the scrape runs every `INDEX_SCRAPE_INTERVAL_MS`
 * (5 minutes by default) while the market is open, so one pass always lands inside these six
 * minutes no matter where the worker's own clock drifts.
 */
export const OPEN_CAPTURE_OPEN_MINUTES = 9 * 60 + 30;
export const OPEN_CAPTURE_CLOSE_MINUTES = 9 * 60 + 36;

/**
 * The opening level to store on the session's row, or `null` to leave whatever is already there.
 *
 * PSX publishes no open for an index — the market-summary carousel the index scrape reads carries
 * level, change and percent only (see `psxIndices.scraper.ts`) — and `dps.psx.com.pk`, whose series
 * did carry one, is refused at the edge. So the opening level here is the first reading we take in
 * the session, which is also the exchange's own definition: the index level at the session's first
 * trade. At a five-minute cadence that reading lands within a few minutes of 09:30, not at it.
 *
 * Two rules keep the number honest:
 *  - Only the first reading counts. An open the row already has is never overwritten (a real one
 *    from the DPS series, if that source returns, always wins), and a reading outside the window is
 *    refused — so a pass whose first success is 11:00 records nothing rather than labelling an
 *    11:00 level as the open. `isMarketOpen` adds the weekday guard: over a weekend the carousel
 *    still answers, with Friday's level, and that must not be written as anybody's open.
 *  - `null` means "nothing to say about the open", and the repository leaves the column alone, so
 *    the later passes of the same session cannot blank what this one captured.
 */
export function openingLevelFor(args: { now: Date; level: number; existingOpen: number | null }): number | null {
  if (args.existingOpen !== null) return null;
  const inWindow = isMarketOpen(args.now, {
    openMinutes: OPEN_CAPTURE_OPEN_MINUTES,
    closeMinutes: OPEN_CAPTURE_CLOSE_MINUTES,
  });
  return inWindow ? args.level : null;
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

    // The page carries no open, so the day's row is read first: its `open` is what decides whether
    // this reading may become the session's opening level.
    const dayRow = await prisma.indexValue.findUnique({
      where: { indexId_tradeDate: { indexId: row.id, tradeDate: stamp } },
      select: { open: true },
    });
    const open = openingLevelFor({
      now,
      level: index.level,
      existingOpen: dayRow?.open == null ? null : dayRow.open.toNumber(),
    });

    valuesWritten += await indexRepository.upsertValues(row.id, [
      { date: stamp.toISOString(), close: index.level, open, volume: null },
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
