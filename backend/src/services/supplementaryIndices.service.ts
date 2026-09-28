import { prisma } from '../database/prisma';
import { indexRepository } from '../repositories/index.repository';
import { childLogger } from '../utils/logger';
import { backfillIndex, sourcePublishesIndex } from './indexHistoryBackfill.service';

/**
 * The indices we track that **no board carries**, named here because there is no list to read them
 * from.
 *
 * `HBLTTI`, the HBL Total Treasury Index, is why this exists. Sarmaaya publishes it — its own page
 * (`https://sarmaaya.pk/indexes/HBLTTI`, titled "HBLTTI - HBL TOTAL TREASURY INDEX"),
 * `price-history/HBLTTI` (22 sessions in the last 30 days, newest 2026-09-25 at 19122.92) and
 * `volume-history/HBLTTI` all answer — but it is on **neither** board: Sarmaaya's board comes back
 * `{limit: 100, total: 17}` without it, and the exchange's carousel lists the same 17. Our tracked
 * set is built from the board read (`scrapeIndices` upserts what the board carries), so an index
 * published only in Sarmaaya's indexes section could never appear on the dashboard at all.
 *
 * This is the one place the index side departs from "whatever the source lists is what we track",
 * and it is a departure of *discovery* only: the symbol is named, the values are not. Every symbol
 * here is verified against the source before anything is written (see below), nothing is invented
 * for it, and the history comes from the same insert-only Sarmaaya back-fill that fills the other
 * indices — so a symbol the source stops answering for is skipped rather than tracked empty.
 *
 * There is no live reading for it either, and that is honest rather than missing: the boards are
 * where a live level comes from, and no board publishes this index. Its card carries the published
 * session values it does have.
 */
export interface SupplementaryIndex {
  symbol: string;
  /** Spelled as the source itself titles it, from the page `<title>`: "HBLTTI - HBL TOTAL TREASURY INDEX". */
  name: string;
}

export const SUPPLEMENTARY_INDICES: ReadonlyArray<SupplementaryIndex> = [
  { symbol: 'HBLTTI', name: 'HBL Total Treasury Index' },
];

/** What registration needs, injectable so the rule is testable without a database or the network. */
export interface SupplementaryDeps {
  findBySymbol(symbol: string): Promise<{ id: string } | null>;
  create(symbol: string, name: string): Promise<void>;
  /** Sessions the source publishes for the symbol. Zero means it does not answer for it. */
  sourceSessions(symbol: string): Promise<number>;
  /** Fill the history from the source. Insert-only, so it can never rewrite a session we hold. */
  backfill(symbol: string): Promise<{ fetched: number; inserted: number }>;
  /** Record that the source answered, so this index is not read as never-synced. */
  markSynced(symbol: string): Promise<void>;
}

export const realSupplementaryDeps: SupplementaryDeps = {
  findBySymbol: (symbol) => indexRepository.findBySymbol(symbol),
  create: async (symbol, name) => {
    await prisma.marketIndex.upsert({ where: { symbol }, update: {}, create: { symbol, name } });
  },
  sourceSessions: sourcePublishesIndex,
  backfill: (symbol) => backfillIndex(symbol),
  markSynced: async (symbol) => {
    // No live reading comes with this: `liveValue`/`liveAt` stay null because no board publishes one,
    // and only the sync time is recorded — the per-index sync would otherwise read as never-synced
    // and be re-enqueued on every boot for an index whose series we do hold.
    await prisma.marketIndex.update({ where: { symbol }, data: { lastSyncedAt: new Date() } });
  },
};

/**
 * Register the indices no board carries, each one behind a source check, and keep what the source
 * publishes for it.
 *
 * Returns the symbols it created this time, so the pass can log an addition to the universe rather
 * than let it arrive silently. An index the source does not answer for is skipped with a warning, and
 * a history fill that fails leaves the row in place — the row is the registration, and the series is
 * retried by the next pass.
 *
 * A symbol already tracked is still *filled* on every pass, because nothing else keeps it current:
 * the per-index sync reads the exchange's own series (`dps.psx.com.pk`), which refuses this host and
 * does not carry this index anyway. The fill is insert-only, so this can never rewrite a session we
 * already hold, and it logs only when a session is actually added.
 */
export async function registerSupplementaryIndices(deps: SupplementaryDeps = realSupplementaryDeps): Promise<string[]> {
  const log = childLogger({ op: 'index-scrape' });
  const registered: string[] = [];

  const fill = async (symbol: string): Promise<void> => {
    try {
      const filled = await deps.backfill(symbol);
      await deps.markSynced(symbol);
      if (filled.inserted > 0) {
        log.info('index-scrape.supplementary_sessions_added', {
          symbol,
          fetched: filled.fetched,
          inserted: filled.inserted,
        });
      }
    } catch (error) {
      log.warn('index-scrape.supplementary_backfill_failed', {
        symbol,
        error: (error as Error).message.slice(0, 120),
      });
    }
  };

  for (const { symbol, name } of SUPPLEMENTARY_INDICES) {
    if (await deps.findBySymbol(symbol)) {
      await fill(symbol);
      continue;
    }

    const sessions = await deps.sourceSessions(symbol).catch((error: unknown) => {
      log.warn('index-scrape.supplementary_unverified', {
        symbol,
        reason: `the source could not be asked: ${(error as Error).message.slice(0, 100)}`,
      });
      return 0;
    });
    if (sessions === 0) {
      log.warn('index-scrape.supplementary_unverified', {
        symbol,
        reason: 'the source publishes no session for it',
      });
      continue;
    }

    await deps.create(symbol, name);
    registered.push(symbol);
    log.info('index-scrape.supplementary_registered', { symbol, name, sourceSessions: sessions });
    await fill(symbol);
  }

  return registered;
}
