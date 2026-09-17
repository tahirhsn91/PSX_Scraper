import type IORedis from 'ioredis';
import { env } from '../config';
import { childLogger, logger } from '../utils/logger';
import { scrapeSymbol } from '../scrapers/orchestrator';
import { fetchUniverse } from '../scrapers/universe.scraper';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { stockRepository } from '../repositories/stock.repository';
import { isClosingPassDue, isMarketOpen, resolvePassKind } from '../utils/marketHours';
import { passLockTtlSeconds } from '../utils/universePacing';
import { enqueueUniverseSymbols } from '../jobs/queues';
import { createRedisConnection } from '../jobs/connection';
import { verifyAndPersist, type UnwrittenField } from './verifiedWrite.service';

export type PassKind = 'intraday' | 'close';
export type PassRequestKind = 'auto' | PassKind;

export interface PassSummary {
  requested: PassRequestKind;
  /** The pass actually run, or null when the clock owes no pass. */
  kind: PassKind | null;
  discovered: number;
  enqueued: number;
  /** Set when the pass did not run — outside market hours, already claimed, disabled. */
  skipped?: string;
}

export interface SymbolOutcome {
  symbol: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NOT_LISTED';
  written: string[];
  unwritten: UnwrittenField[];
  reason?: string;
}

/** PKT is a fixed UTC+5, so the session key is arithmetic, not a timezone database. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function pktSessionKey(now: Date): string {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Local (PKT) wall clock, for logs that have to make sense to a human in Karachi. */
function pktClock(now: Date): string {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') + ' PKT';
}

let redis: IORedis | null = null;
const getRedis = (): IORedis => (redis ??= createRedisConnection());

/**
 * Claim the closing pass for this session.
 *
 * The in-hours cron keeps firing after the close, so without a claim the closing pass would run
 * ~170 times a session. `SET NX` makes the claim atomic — a check-then-set would let two workers
 * both decide they were first.
 */
async function claimClosingPass(now: Date): Promise<boolean> {
  const key = `universe:close-pass:${pktSessionKey(now)}`;
  const claimed = await getRedis().set(key, '1', 'EX', 60 * 60 * 48, 'NX');
  return claimed === 'OK';
}

/**
 * Claim the right to run a pass.
 *
 * The cron fires every few minutes while a pass takes ~15-25 minutes, so without this each tick
 * would enqueue another full walk and the same symbol would be scraped several times over. The
 * TTL means a pass that dies (deploy, crash) does not wedge the worker — the next tick picks up
 * once the lock expires.
 */
async function claimPassLock(now: Date, symbolCount: number): Promise<boolean> {
  const key = 'universe:pass-lock';
  const claimed = await getRedis().set(
    key,
    pktSessionKey(now),
    'EX',
    passLockTtlSeconds(symbolCount, env.UNIVERSE_PACING_MS),
    'NX',
  );
  return claimed === 'OK';
}

/**
 * Start one pass over the whole listed universe.
 *
 * The pass itself does no scraping: it discovers the symbols and hands each one to the queue as
 * its own job, delayed by its position in the list. That gives three things at once — the board
 * is walked one symbol at a time (the queue's concurrency is 1), the source is not burst (pacing),
 * and a failure on one symbol is retried without losing the rest of the pass.
 */
export async function startUniversePass(
  requested: PassRequestKind = 'auto',
  now = new Date(),
): Promise<PassSummary> {
  const skip = (reason: string, kind: PassKind | null = null): PassSummary => {
    // Logged, not just returned: a skip that only shows up in a job's return value is invisible,
    // which is how a schedule that asked for the wrong kind of pass went unnoticed.
    logger.info('universe.pass_skipped', { requested, reason, pkt: pktClock(now) });
    return { requested, kind, discovered: 0, enqueued: 0, skipped: reason };
  };

  if (!env.UNIVERSE_ENABLED) return skip('UNIVERSE_ENABLED is false');

  const kind: PassKind | null = requested === 'auto' ? resolvePassKind(now) : requested;
  if (kind === null) return skip('outside market hours and past the closing window');
  // An explicit kind overrides the *choice* the clock would make, not the market hours: an
  // in-hours pass off-hours would re-read the closing values and post nothing new. (The closing
  // pass is the off-hours path, and it has its own window.)
  if (kind === 'intraday' && !isMarketOpen(now)) return skip('intraday pass requested outside market hours', kind);

  if (kind === 'close' && !(await claimClosingPass(now))) {
    return skip('closing pass already ran for this session', kind);
  }

  const { symbols } = await fetchUniverse(env.UNIVERSE_SITEMAP_URL);
  if (!(await claimPassLock(now, symbols.length))) {
    return skip('a pass is already in flight', kind);
  }

  await enqueueUniverseSymbols(symbols, kind, env.UNIVERSE_PACING_MS);

  logger.info('universe.pass_started', {
    kind,
    discovered: symbols.length,
    pacingMs: env.UNIVERSE_PACING_MS,
    session: pktSessionKey(now),
    pkt: pktClock(now),
  });
  return { requested, kind, discovered: symbols.length, enqueued: symbols.length };
}

/**
 * Scrape one symbol of the universe and write only what passed verification.
 *
 * A symbol that fails the listing checks is *not* added: an old quote means the page outlived the
 * listing, and creating a row for it would put a dead security back on the dashboard. A symbol
 * that is listed but has a field that fails keeps its row and shows a dash for that field.
 */
export async function runUniverseSymbol(
  symbol: string,
  kind: PassKind = 'intraday',
  now = new Date(),
): Promise<SymbolOutcome> {
  const sym = symbol.toUpperCase();
  const log = childLogger({ symbol: sym, op: 'universe' });
  const started = new Date();
  const existing = await stockRepository.findBySymbol(sym);
  const syncLog = await syncLogRepository.start(sym, existing?.id ?? null);

  try {
    const { result, outcomes } = await scrapeSymbol(sym);
    const write = await verifyAndPersist(result, { stockId: existing?.id ?? null, now, log });

    if (!write.listed) {
      log.warn('universe.not_listed', {
        reason: write.notListedReason,
        sessionDate: result.price?.lastTradeDate ?? null,
        price: result.price?.currentPrice ?? null,
        sources: outcomes,
      });
      await syncLogRepository.complete(syncLog.id, 'FAILED', started, `not listed: ${write.notListedReason}`);
      return { symbol: sym, status: 'NOT_LISTED', written: [], unwritten: [], reason: write.notListedReason };
    }

    const rejection = write.unwritten.find((v) => v.status === 'rejected');
    await syncLogRepository.complete(
      syncLog.id,
      write.status,
      started,
      write.unwritten
        .filter((v) => v.status === 'rejected')
        .map((v) => `${v.field}: ${v.reason ?? 'rejected'}`)
        .join('; ') || undefined,
    );
    log.info('universe.symbol_done', {
      kind,
      status: write.status,
      written: write.written,
      unwritten: write.unwritten.map((v) => `${v.field}:${v.status}`),
    });

    return {
      symbol: sym,
      status: write.listed && rejection ? 'PARTIAL' : write.status,
      written: write.written,
      unwritten: write.unwritten,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await syncLogRepository.complete(syncLog.id, 'FAILED', started, message);
    log.error('universe.symbol_failed', { message });
    throw err;
  }
}
