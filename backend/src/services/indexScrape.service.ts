import { Prisma } from '@prisma/client';
import type IORedis from 'ioredis';
import { prisma } from '../database/prisma';
import { indexRepository } from '../repositories/index.repository';
import { fetchPsxIndices, fetchIndexNames } from '../scrapers/psxIndices.scraper';
import { sessionStamp } from '../scrapers/parse.utils';
import { createRedisConnection } from '../jobs/connection';
import { isClosingPassDue, isMarketOpen } from '../utils/marketHours';
import { childLogger } from '../utils/logger';
import { tradingDayState, type TradingDayState } from './marketCalendar.service';

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
  /** Rows of a previous session corrected to the exchange's own implied close. */
  repaired: number;
  /** What the calendar said about the day this pass ran on. */
  sessionDay?: TradingDayState;
  /** False when the pass declined to write a session row - a weekend, a listed holiday, or no
   *  readable calendar. The live snapshot is written either way. */
  sessionRowWritten?: boolean;
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

/** PKT is a fixed UTC+5, so the session key is arithmetic, not a timezone database. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The Karachi calendar day an instant falls on — the key a session is claimed under. */
export function pktSessionKey(now: Date): string {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a session's close is settled: 15:35 PKT on the session's own day. */
export function sessionCloseAt(tradeDate: Date): Date {
  const pkt = new Date(tradeDate.getTime() + PKT_OFFSET_MS);
  const midnightUtc = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate());
  return new Date(midnightUtc + (15 * 60 + 35) * 60 * 1000 - PKT_OFFSET_MS);
}

/**
 * Whether a reading was taken after its session's close — i.e. whether the value it produced can
 * be read as that session's close.
 *
 * A session's row is upserted in place on every pass, so `value` alone cannot say what it is; the
 * row's `value_at` is the only thing on it that can. Null means no reading we can point at, which
 * is not a close either. 15:35 is the moment `isClosingPassDue` treats as settled, so the two agree
 * on what "after the close" means.
 */
export function isPostCloseReading(valueAt: Date | null, tradeDate: Date): boolean {
  return valueAt !== null && valueAt.getTime() > sessionCloseAt(tradeDate).getTime();
}

/** A paisa: closer than this and two index levels are the same number, not a correction. */
const LEVEL_EPSILON = 0.005;

/**
 * The value a stored row should be corrected to, or `null` to leave it exactly as it is.
 *
 * A session whose close was never captured still has one, published: the exchange's market-summary
 * page gives each index's `level` and its `change` against the exchange's own previous close, so
 * `level - change` *is* the previous session's close — an independent observation from the same
 * page, not a figure we derived. Measured on 2026-09-26 that arithmetic reproduced the stored 24 Sep
 * row for all 17 indices to the paisa, which is what licenses using it to repair the row for 25 Sep.
 *
 * The catch is that it is only the previous session's close while the page is describing a *live*
 * session — so the caller gates on that (see `scrapeIndices`). Over a weekend the page still serves
 * the last session's figures, and the same arithmetic would "correct" the last row to its own
 * previous close, which is why a weekend pass must never reach here.
 *
 * A row already holding a post-close reading is left alone: a real close outranks a repair.
 */
export function repairedValueFor(args: {
  storedValue: number;
  valueAt: Date | null;
  tradeDate: Date;
  impliedClose: number | null;
}): number | null {
  if (args.impliedClose === null || !Number.isFinite(args.impliedClose)) return null;
  if (isPostCloseReading(args.valueAt, args.tradeDate)) return null;
  if (Math.abs(args.storedValue - args.impliedClose) < LEVEL_EPSILON) return null;
  return args.impliedClose;
}

export async function scrapeIndices(now = new Date()): Promise<IndexScrapeResult> {
  const log = childLogger({ op: 'index-scrape' });
  const parsed = await fetchPsxIndices();
  // Cosmetic only; an empty map means the symbol stays as the name.
  const names = await fetchIndexNames(parsed.map((i) => i.symbol));
  // The same session key the rest of the pipeline uses (16:00 PKT), so an index row lines up
  // with the stock rows for that day.
  const stamp = new Date(sessionStamp(now.toISOString())!);

  // Whether a session row may exist at all. `marketHours` counts the weekdays and cannot tell a
  // trading Wednesday from a holiday one, and this pass runs pre-open, hours before the exchange
  // publishes anything - which is how 2026-08-26 (a holiday it never opened on) came to exist as
  // 441 stock rows plus this board's row, all carrying the previous close and `volume = 0`. A
  // phantom session then reached the candles API, the 52W columns and "last traded", so the
  // calendar vetoes the row this pass would otherwise synthesise.
  //
  // It never vetoes a *published* one. PSX's list carries 2026-08-25 - a Tuesday that traded, and
  // that both independent session calendars publish - so an Eid date can land a day either side of
  // the published one, and the closing pass (which reads a real session) stays the authority on
  // whether a session happened. `unknown` (the calendar could not be read) is treated as "no
  // evidence": a missing session is recoverable from the published series, a phantom one is not.
  const sessionDay = await tradingDayState(stamp);
  const writeSessionRow = sessionDay === 'trading';
  if (!writeSessionRow) {
    log.warn('index-scrape.session_skipped', {
      date: stamp.toISOString().slice(0, 10),
      reason: sessionDay,
    });
  }

  let created = 0;
  let updated = 0;
  let valuesWritten = 0;
  let repaired = 0;

  // `level - change` is the previous session's close only while the page describes a live session.
  // Over a weekend or a holiday the carousel still answers, with the last session's figures, and the
  // same arithmetic would "correct" that session's row to its own previous close — so repair is
  // confined to the sessions a pass can legitimately be about.
  const canRepair = isMarketOpen(now) || isClosingPassDue(now);

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

    if (writeSessionRow) {
      valuesWritten += await indexRepository.upsertValues(row.id, [
        // `valueAt` is when this reading was taken: the only thing on the row that can say whether the
        // value it lands on is a close (see `isPostCloseReading`).
        { date: stamp.toISOString(), close: index.level, open, volume: null, valueAt: now },
      ]);
    }

    if (canRepair) {
      // The session before this one, which is the row the exchange's implied close is about.
      const previous = await prisma.indexValue.findFirst({
        where: { indexId: row.id, tradeDate: { lt: stamp } },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true, value: true, valueAt: true },
      });
      if (previous) {
        const corrected = repairedValueFor({
          storedValue: previous.value.toNumber(),
          valueAt: previous.valueAt,
          tradeDate: previous.tradeDate,
          impliedClose: index.change === null ? null : index.level - index.change,
        });
        if (corrected !== null) {
          await prisma.indexValue.update({
            where: { indexId_tradeDate: { indexId: row.id, tradeDate: previous.tradeDate } },
            // Only the value: `value_at` stays as it was, so the row still says that its close was
            // never captured and that this figure came from the exchange's own arithmetic.
            data: { value: new Prisma.Decimal(corrected) },
          });
          repaired += 1;
        }
      }
    }
  }

  const result: IndexScrapeResult = {
    symbols: parsed.length,
    created,
    updated,
    valuesWritten,
    namesResolved: Object.keys(names).length,
    repaired,
    sessionDay,
    sessionRowWritten: writeSessionRow,
  };
  log.info('index-scrape.done', { ...result, stamp: stamp.toISOString() });
  return result;
}

let redis: IORedis | null = null;
const getRedis = (): IORedis => (redis ??= createRedisConnection());

/**
 * Claim the closing pass for a session.
 *
 * The board timer keeps firing every `INDEX_SCRAPE_INTERVAL_MS` once a session's close has passed,
 * so without a claim the closing pass would run ~170 times a session. `SET NX` makes the claim
 * atomic, exactly as the universe runner's closing pass does — a check-then-set would let two
 * workers both decide they were first.
 */
async function claimIndexClosingPass(now: Date): Promise<boolean> {
  const key = `indices:close-pass:${pktSessionKey(now)}`;
  const claimed = await getRedis().set(key, '1', 'EX', 60 * 60 * 48, 'NX');
  return claimed === 'OK';
}

export interface IndexClosingPassResult {
  ran: boolean;
  reason: 'not-due' | 'already-claimed' | 'ran';
  result?: IndexScrapeResult;
}

/**
 * The once-per-session pass that reads each index's settled level.
 *
 * The board snapshot runs only while `isMarketOpen` (09:25–15:35 PKT) and upserts a session's row in
 * place, so the number the row ends the day with is whatever the last successful pass read — not
 * necessarily the close. On 2026-09-26 that was visible on all 17 indices: each newest row held a
 * 09:25 pre-open reading while the session had closed up, and every figure derived from the series
 * (the comparison charts, change, percent) inherited it with no way to tell. This pass guarantees
 * the close is read; the claim guarantees it is read once, not on every tick of the timer that
 * follows it.
 *
 * Deliberately not gated by `INDEX_SCRAPE_MARKET_HOURS_ONLY`: that flag is on by default and exists
 * to stop useless in-hours polling, which would also stop this. `claim` and `scrape` are injectable
 * so the rule is testable without Redis or a live page.
 */
export async function runIndexClosingPass(
  args: {
    now?: Date;
    claim?: (now: Date) => Promise<boolean>;
    scrape?: (now: Date) => Promise<IndexScrapeResult>;
  } = {},
): Promise<IndexClosingPassResult> {
  const now = args.now ?? new Date();
  if (!isClosingPassDue(now)) return { ran: false, reason: 'not-due' };
  const claim = args.claim ?? claimIndexClosingPass;
  if (!(await claim(now))) return { ran: false, reason: 'already-claimed' };
  const scrape = args.scrape ?? scrapeIndices;
  return { ran: true, reason: 'ran', result: await scrape(now) };
}

export type IndexBoardPassResult =
  | { ran: true; kind: 'closing' | 'intraday'; result: IndexScrapeResult }
  | { ran: false; reason: 'outside-hours' | 'not-due' | 'already-claimed' };

/**
 * One tick of the index board timer.
 *
 * The board snapshot itself only runs while the market is open, so after 15:35 PKT a tick has
 * nothing to read — and that is precisely when the session's close has to be read. So the closing
 * pass goes first: it self-gates on `isClosingPassDue` and claims the session, which means an
 * in-hours tick spends one Redis call and is told `not-due`, while the first tick after the settle
 * performs the pass that makes the session's row its close rather than its last in-session reading.
 *
 * `scrapeIndices` guards itself — it decides whether a session row may exist at all, and gates the
 * previous-session repair on the market being open — so an off-hours call cannot fabricate a row.
 * The intraday path is gated here anyway: there is no reason to read a page that cannot change.
 * `closing` and `scrape` are injectable so the rule is testable without Redis or a browser.
 */
export async function runIndexBoardPass(args: {
  now?: Date;
  closing?: (a: { now: Date }) => Promise<IndexClosingPassResult>;
  scrape?: (now: Date) => Promise<IndexScrapeResult>;
} = {}): Promise<IndexBoardPassResult> {
  const now = args.now ?? new Date();
  const closing = await (args.closing ?? runIndexClosingPass)({ now });
  if (closing.result) return { ran: true, kind: 'closing', result: closing.result };
  if (!isMarketOpen(now)) {
    return { ran: false, reason: closing.reason === 'already-claimed' ? 'already-claimed' : 'outside-hours' };
  }
  const scrape = args.scrape ?? scrapeIndices;
  return { ran: true, kind: 'intraday', result: await scrape(now) };
}
