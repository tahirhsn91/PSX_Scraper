import { prisma } from '../database/prisma';
import { fetchIndexMembers } from '../scrapers/sarmaayaIndexMembers.scraper';
import { indexConstituentRepository } from '../repositories/indexConstituent.repository';
import { syncKse100Membership, KSE100_SYMBOL } from './kse100Membership.service';
import { childLogger } from '../utils/logger';

/**
 * Keep every published index's member list current.
 *
 * Why this exists: the universe card and the symbol table's index selector both read
 * `index_constituents`, and only the KSE-100 had rows in it — so any other index filtered to
 * nothing (or, worse, silently unfiltered). PSX publishes 17 indices and all 17 have real member
 * lists upstream, so the pass that used to keep one group current now keeps them all.
 *
 * Two sources, one rule each:
 *  - **KSE100 keeps the exchange's own member site** (scstrade, via `syncKse100Membership`). Page
 *    one of the dashboard is built from that list and it is the only source that prints company
 *    names; re-pointing it at the ticker would also change its *membership* — scstrade publishes
 *    99 rows where the ticker carries 100 (HGFA carries no price there). That is a data change
 *    nobody asked for, so it stays exactly where it was.
 *  - **The other 16 come from the sarmaaya ticker**, parameterised by index symbol.
 *
 * Every index is written the same way: resolve the published symbols to *tracked* stocks, then
 * `replaceForIndex`. A symbol we do not track is reported in the summary and never added — the
 * membership list is not a discovery path, and it is exactly the kind of input that would
 * resurrect a symbol somebody removed on purpose (see the removal rules in the development notes).
 */
export interface IndexMembershipSummary {
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

export interface AllIndexMembershipSummary {
  /** Indices this pass attempted. */
  indices: number;
  synced: IndexMembershipSummary[];
  /** Indices whose source refused or failed — reported, and nothing written for them. */
  failed: Array<{ index: string; error: string }>;
  durationMs: number;
}

/**
 * Sync one index's membership from its source.
 *
 * `name` is only used when the index row does not exist yet (a fresh database); the display name
 * for a known index is the one `market_indices` already carries. Falling back to the symbol keeps
 * the row creatable without inventing a longer name.
 */
export async function syncIndexMembership(
  indexSymbol: string,
  name?: string,
): Promise<IndexMembershipSummary> {
  const symbol = indexSymbol.trim().toUpperCase();
  // The KSE-100 pass is its own, already-tested entry point and keeps the exchange's member site;
  // delegating here means a caller cannot swap page one's source by reaching for the generic
  // function instead.
  if (symbol === KSE100_SYMBOL) return syncKse100Membership();

  const log = childLogger({ op: 'index-membership', index: symbol });
  const started = Date.now();

  const constituents = await fetchIndexMembers(symbol);

  // An empty answer here is the source saying it has no member list for this symbol: measured
  // 2026-09-24, `?index=NOPE` answers `{success: true, response: []}` with http 200 — the same body
  // a transient empty read would produce. Membership is a *replace*, so writing that would silently
  // empty an index this pass cannot see members for, and the pass would log success. Nothing is
  // written and the index is reported instead; the caller's loop carries on with the others.
  if (constituents.length === 0) {
    throw new Error(`Source published no members for ${symbol} — member list left unchanged`);
  }

  const index = await prisma.marketIndex.upsert({
    where: { symbol },
    update: {},
    create: { symbol, name: name ?? symbol },
    select: { id: true },
  });

  const symbols = constituents.map((row) => row.symbol);
  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: symbols } },
    select: { id: true, symbol: true },
  });
  const idBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock.id]));

  const unknown = symbols.filter((s) => !idBySymbol.has(s));

  const rows = constituents.flatMap((row, position) => {
    const stockId = idBySymbol.get(row.symbol);
    return stockId ? [{ stockId, name: row.name, position: position + 1 }] : [];
  });

  const { added, removed, kept } = await indexConstituentRepository.replaceForIndex(index.id, rows);

  // Deliberately NOT stamping market_indices.last_synced_at here. That column means "this index's
  // values were last synced", and `scheduler.ts` reads it at boot to decide which indices still
  // need a catch-up: a membership pass that stamped it could let a restart straight after a pass
  // skip a stale index value set. KSE100 has stamped it since before this pass existed — left
  // alone on purpose, because changing page one's behaviour is its own decision.

  const summary: IndexMembershipSummary = {
    index: symbol,
    fetched: constituents.length,
    matched: rows.length,
    unknown,
    added,
    removed,
    kept,
    durationMs: Date.now() - started,
  };
  log.info('index-membership.done', summary);
  if (unknown.length > 0) {
    log.warn('index-membership.untracked', { index: symbol, count: unknown.length, symbols: unknown });
  }
  return summary;
}

/**
 * Sync every index in `market_indices`. The daily scheduled pass, and the only entry point the
 * worker calls.
 *
 * Sequential, one request at a time: 17 bulk requests fired in a burst is the shape that earns a
 * 429 from this host (measured for the per-symbol leg), and this pass runs daily — ~15s of work is
 * not worth a rate limit. One index failing does not cost the other sixteen their refresh: the
 * failure is reported per index and the pass carries on with nothing written for the failed one.
 */
export async function syncAllIndexMembership(): Promise<AllIndexMembershipSummary> {
  const log = childLogger({ op: 'index-membership-pass' });
  const started = Date.now();

  const indices = await prisma.marketIndex.findMany({
    select: { symbol: true, name: true },
    orderBy: { symbol: 'asc' },
  });

  // KSE100 is walked even when `market_indices` has no row for it: this pass replaced a job that
  // ran the KSE-100 sync unconditionally, and page one of the dashboard must not start depending
  // on the index scrape having populated the table first.
  const targets: Array<{ symbol: string; name?: string }> = indices.map((i) => ({
    symbol: i.symbol,
    name: i.name,
  }));
  if (!targets.some((t) => t.symbol === KSE100_SYMBOL)) targets.unshift({ symbol: KSE100_SYMBOL });

  const synced: IndexMembershipSummary[] = [];
  const failed: Array<{ index: string; error: string }> = [];

  for (const target of targets) {
    try {
      synced.push(await syncIndexMembership(target.symbol, target.name));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ index: target.symbol, error: message });
      log.warn('index-membership.index_failed', { index: target.symbol, error: message });
    }
  }

  const summary: AllIndexMembershipSummary = {
    indices: targets.length,
    synced,
    failed,
    durationMs: Date.now() - started,
  };
  log.info('index-membership.pass_done', {
    indices: targets.length,
    synced: synced.length,
    failed: failed.length,
    members: synced.reduce((total, s) => total + s.matched, 0),
    untracked: synced.reduce((total, s) => total + s.unknown.length, 0),
    durationMs: summary.durationMs,
  });
  return summary;
}
