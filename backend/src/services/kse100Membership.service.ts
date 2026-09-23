import { prisma } from '../database/prisma';
import { fetchKse100 } from '../scrapers/scstradeKse100.scraper';
import { indexConstituentRepository } from '../repositories/indexConstituent.repository';
import { childLogger } from '../utils/logger';

/**
 * Keep the KSE-100 member list current, from the exchange's own member site.
 *
 * This is what page one of the dashboard shows, so the pass answers two questions in one go: who
 * is in the index now, and did anything change since last time. A membership list is a *replace*
 * — a company that leaves the index must leave the group, or a former constituent keeps its place
 * on page one indefinitely.
 *
 * The pass is deliberately cheap (one request, ~0.6s) and runs daily; the index rebalances twice a
 * year, so daily is already far more often than the list can change.
 */
export const KSE100_SYMBOL = 'KSE100';
const KSE100_NAME = 'KSE 100 Index';

export interface Kse100MembershipSummary {
  index: string;
  /** Rows the source published. */
  fetched: number;
  /** Rows we could match to a tracked symbol. */
  matched: number;
  /** Published in the index, not tracked here — reported, never added by this pass. */
  unknown: string[];
  added: number;
  removed: number;
  kept: number;
  durationMs: number;
}

export async function syncKse100Membership(): Promise<Kse100MembershipSummary> {
  const log = childLogger({ op: 'kse100-membership' });
  const started = Date.now();

  const constituents = await fetchKse100();

  const index = await prisma.marketIndex.upsert({
    where: { symbol: KSE100_SYMBOL },
    update: {},
    create: { symbol: KSE100_SYMBOL, name: KSE100_NAME },
    select: { id: true },
  });

  const symbols = constituents.map((row) => row.symbol);
  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: symbols } },
    select: { id: true, symbol: true },
  });
  const idBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock.id]));

  // A symbol the index publishes but we do not track is *reported*, never added here. What we
  // track is the discovery pass's decision, and a membership list is exactly the kind of input
  // that would resurrect a symbol somebody removed on purpose (see the removal rules in the
  // development notes) — the two would then disagree with nothing to adjudicate between them.
  const unknown = symbols.filter((symbol) => !idBySymbol.has(symbol));

  const rows = constituents.flatMap((row, position) => {
    const stockId = idBySymbol.get(row.symbol);
    return stockId ? [{ stockId, name: row.name, position: position + 1 }] : [];
  });

  const { added, removed, kept } = await indexConstituentRepository.replaceForIndex(index.id, rows);
  await prisma.marketIndex.update({ where: { id: index.id }, data: { lastSyncedAt: new Date() } });

  const summary: Kse100MembershipSummary = {
    index: KSE100_SYMBOL,
    fetched: constituents.length,
    matched: rows.length,
    unknown,
    added,
    removed,
    kept,
    durationMs: Date.now() - started,
  };
  log.info('kse100-membership.done', summary);
  if (unknown.length > 0) {
    log.warn('kse100-membership.untracked', { index: KSE100_SYMBOL, symbols: unknown });
  }
  return summary;
}

/** The index's member count and the rest of the tracked universe, for the dashboard's pager. */
export function kse100GroupCounts(): Promise<{ members: number; rest: number }> {
  return indexConstituentRepository.groupCounts(KSE100_SYMBOL);
}
