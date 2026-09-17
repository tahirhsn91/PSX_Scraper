import type IORedis from 'ioredis';
import { env } from '../config';
import { childLogger, logger } from '../utils/logger';
import { scrapeSymbol } from '../scrapers/orchestrator';
import { fetchUniverse } from '../scrapers/universe.scraper';
import { persistScrapeResult } from '../repositories/scrapeResult.repository';
import { syncLogRepository } from '../repositories/syncLog.repository';
import { stockRepository } from '../repositories/stock.repository';
import { median, previousCloseBefore, recentVolumes } from '../repositories/stockPrice.repository';
import { isClosingPassDue, isMarketOpen, resolvePassKind } from '../utils/marketHours';
import { passLockTtlSeconds } from '../utils/universePacing';
import { enqueueUniverseSymbols } from '../jobs/queues';
import { createRedisConnection } from '../jobs/connection';
import type { ScrapeResult } from '../types/dto';
import {
  type ScrapedQuote,
  type VerificationContext,
  type VerificationResult,
  unwrittenVerdicts,
  verifyQuote,
} from './quoteVerification.service';

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

/** Local (PKT) wall clock, for logs that have to make sense to a human in Karachi. */
function pktClock(now: Date): string {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') + ' PKT';
}

export interface SymbolOutcome {
  symbol: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NOT_LISTED';
  written: string[];
  unwritten: { field: string; status: string; rawValue: number | null; reason?: string }[];
  reason?: string;
}

/** PKT is a fixed UTC+5, so the session key is arithmetic, not a timezone database. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function pktSessionKey(now: Date): string {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
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
  const key = `universe:pass-lock`;
  const claimed = await getRedis().set(key, pktSessionKey(now), 'EX', passLockTtlSeconds(symbolCount, env.UNIVERSE_PACING_MS), 'NX');
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

/** Map the orchestrator's price block onto the shape the verifier checks. */
function toScrapedQuote(symbol: string, result: ScrapeResult): ScrapedQuote {
  const p = result.price;
  return {
    symbol,
    price: p?.currentPrice ?? null,
    change: p?.change ?? null,
    changePercent: p?.changePercent ?? null,
    volume: p?.volume ?? null,
    week52Low: p?.week52Low ?? null,
    week52High: p?.week52High ?? null,
    // Session-stamped by the scraper from the source's own quote timestamp, so this is the
    // session the reading belongs to rather than the moment we fetched it (#38).
    sessionDate: p?.lastTradeDate ?? null,
  };
}

async function buildContext(stockId: string | null, sessionDate: string | null, now: Date): Promise<VerificationContext> {
  const base = {
    previousClose: null as number | null,
    volumeMedian: null as number | null,
    maxVolumeMultiple: env.UNIVERSE_MAX_VOLUME_MULTIPLE,
    maxQuoteAgeDays: env.UNIVERSE_MAX_QUOTE_AGE_DAYS,
    now,
  };
  if (!stockId || !sessionDate) return base;

  const [previousClose, volumes] = await Promise.all([
    previousCloseBefore(stockId, new Date(sessionDate)),
    recentVolumes(stockId),
  ]);
  return { ...base, previousClose, volumeMedian: median(volumes) };
}

/** Null out everything the verifier did not accept, so the write cannot carry a bad value. */
export function applyVerdicts(result: ScrapeResult, verification: VerificationResult): void {
  if (!result.price) return;
  for (const v of unwrittenVerdicts(verification)) {
    switch (v.field) {
      case 'price': result.price.currentPrice = null; break;
      case 'change': result.price.change = null; break;
      case 'changePercent': result.price.changePercent = null; break;
      case 'volume': result.price.volume = null; break;
      case 'week52Low': result.price.week52Low = null; break;
      case 'week52High': result.price.week52High = null; break;
    }
  }
}

function rejectionSummary(verification: VerificationResult): string | undefined {
  const rejected = verification.verdicts.filter((v) => v.status === 'rejected');
  if (rejected.length === 0) return undefined;
  return rejected.map((v) => `${v.field}: ${v.reason ?? 'rejected'}`).join('; ');
}

/**
 * Scrape one symbol of the universe, verify it, and write only what passed.
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
    const quote = toScrapedQuote(sym, result);
    const verification = verifyQuote(quote, await buildContext(existing?.id ?? null, quote.sessionDate, now));

    if (!verification.listed) {
      log.warn('universe.not_listed', {
        reason: verification.notListedReason,
        sessionDate: quote.sessionDate,
        price: quote.price,
        sources: outcomes,
      });
      await syncLogRepository.complete(syncLog.id, 'FAILED', started, `not listed: ${verification.notListedReason}`);
      return { symbol: sym, status: 'NOT_LISTED', written: [], unwritten: [], reason: verification.notListedReason };
    }

    const unwritten = unwrittenVerdicts(verification);
    for (const v of unwritten) {
      log.warn('universe.field_unwritten', {
        field: v.field,
        verdict: v.status,
        rawValue: v.rawValue ?? null,
        reason: v.reason,
        sessionDate: quote.sessionDate,
      });
    }

    applyVerdicts(result, verification);
    await persistScrapeResult(result);

    const status: SymbolOutcome['status'] = unwritten.some((v) => v.status === 'rejected') ? 'PARTIAL' : 'SUCCESS';
    await syncLogRepository.complete(syncLog.id, status, started, rejectionSummary(verification));
    log.info('universe.symbol_done', {
      kind,
      status,
      written: verification.verdicts.filter((v) => v.status === 'ok').map((v) => v.field),
      unwritten: unwritten.map((v) => `${v.field}:${v.status}`),
    });

    return {
      symbol: sym,
      status,
      written: verification.verdicts.filter((v) => v.status === 'ok').map((v) => v.field),
      unwritten: unwritten.map((v) => ({ field: v.field, status: v.status, rawValue: v.rawValue ?? null, reason: v.reason })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await syncLogRepository.complete(syncLog.id, 'FAILED', started, message);
    log.error('universe.symbol_failed', { message });
    throw err;
  }
}
