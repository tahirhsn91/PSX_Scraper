import { prisma } from '../database/prisma';
import { fetchIndexConstituents } from '../scrapers/sarmaayaIndexCompanies.scraper';
import {
  indexContributionRepository,
  type ContributionInput,
} from '../repositories/indexContribution.repository';
import { childLogger } from '../utils/logger';

/**
 * Keep each index's per-stock contribution current.
 *
 * The dashboard's stocks table carries a `POINTS` column: how much each stock moved its index. The
 * source publishes it per constituent (`points`, `weights`) on the same route the index page renders,
 * and it moves through the session — so this pass runs every couple of minutes while the exchange is
 * open rather than once a day like the member list.
 *
 * Two indices are captured, and the reason is coverage rather than interest: the KSE-100 publishes 100
 * members, 100 of which we track, while the broad market (ALLSHR) covers 451 of our 508 symbols. The
 * column reports a stock's KSE-100 contribution where it is a member and its market contribution
 * otherwise, so both legs have to be stored. They are **not** the same scale (the KSE-100 stands at
 * ~168,600 points and the ALLSHR at ~102,100), which is why each stored row keeps its `indexId` and
 * the API says which index a figure belongs to rather than presenting one anonymous number.
 */
export const CONTRIBUTION_INDICES = ['KSE100', 'ALLSHR'] as const;

export interface IndexContributionSummary {
  index: string;
  /** Rows the source published for this index. */
  fetched: number;
  /** Rows we could match to a tracked symbol — the only ones stored. */
  matched: number;
  /** Rows the source carried with no reading (all-zero placeholders); stored as null, never 0. */
  unpublished: number;
  written: number;
  removed: number;
  durationMs: number;
}

async function syncOneIndex(indexSymbol: string, capturedAt: Date): Promise<IndexContributionSummary> {
  const started = Date.now();
  const readings = await fetchIndexConstituents(indexSymbol);

  // The index row may not exist yet for anything but the KSE-100 (the board's own pass creates the
  // others), and a contribution is meaningless without the index it belongs to.
  const index = await prisma.marketIndex.upsert({
    where: { symbol: indexSymbol },
    update: {},
    create: { symbol: indexSymbol, name: indexSymbol },
    select: { id: true },
  });

  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: readings.map((r) => r.symbol) } },
    select: { id: true, symbol: true },
  });
  const idBySymbol = new Map(stocks.map((s) => [s.symbol, s.id]));

  // An index constituent we do not track is skipped, never added: what we track is the discovery
  // pass's decision, and this pass must not resurrect a symbol somebody removed on purpose.
  const rows: ContributionInput[] = readings.flatMap((reading) => {
    const stockId = idBySymbol.get(reading.symbol);
    if (!stockId) return [];
    return [{ stockId, points: reading.points, weight: reading.weight, level: reading.level }];
  });

  const result = await indexContributionRepository.replaceForIndex(index.id, rows, capturedAt);

  return {
    index: indexSymbol,
    fetched: readings.length,
    matched: rows.length,
    unpublished: readings.filter((r) => r.points === null).length,
    written: result.written,
    removed: result.removed,
    durationMs: Date.now() - started,
  };
}

/** Capture every configured index's contributions. One index failing must not lose the others. */
export async function syncIndexContributions(
  symbols: readonly string[] = CONTRIBUTION_INDICES,
): Promise<IndexContributionSummary[]> {
  const log = childLogger({ op: 'index-contributions' });
  const capturedAt = new Date();
  const summaries: IndexContributionSummary[] = [];

  for (const symbol of symbols) {
    try {
      const summary = await syncOneIndex(symbol, capturedAt);
      summaries.push(summary);
      log.info('index-contributions.pass', { ...summary });
    } catch (err) {
      log.warn('index-contributions.failed', {
        index: symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summaries;
}

/** When the index's readings were last taken, so a caller can say how fresh they are. */
export async function lastContributionAt(indexSymbol: string): Promise<Date | null> {
  return indexContributionRepository.lastCapturedAt(indexSymbol);
}
