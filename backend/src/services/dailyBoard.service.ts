import { prisma } from '../database/prisma';
import { stockRepository } from '../repositories/stock.repository';
import { deletedSymbolRepository } from '../repositories/deletedSymbol.repository';
import { enqueueSync } from '../jobs/queues';
import { childLogger } from '../utils/logger';

/**
 * The daily board pass: one request for the whole market, then every listed security is ensured to
 * be tracked and queued for a data refresh.
 *
 * Source note. The board published at `dps.psx.com.pk/market-watch` refuses this host outright —
 * every path except the homepage dies at the connection level, with or without browser navigation
 * headers (issue #27). So the board is read from Sarmaaya's public ticker, the same host the rest
 * of the quote pipeline already trusts, which returns the whole market in one response:
 * `{symbol, price, change, changePercentage, volume, date}`. If dps ever becomes reachable,
 * `fetchBoard` is the single function to repoint.
 *
 * The pass deliberately does **not** write prices itself. It registers what is missing and hands
 * each symbol to the existing sync queue, so every write still goes through the verified-write door
 * (#43) exactly as a poll or a manual sync does.
 */

export interface BoardRow {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  at: string | null;
}

export interface DailyBoardSummary {
  fetched: number;
  registered: string[];
  queued: number;
  failed: number;
}

const BOARD_URL = 'https://beta-restapi.sarmaaya.pk/api/stocks/ticker?index=ALLSHR';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * A number, or null for anything that is not one.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so without this a missing price would register a stock
 * at a level of zero. Absent is not zero.
 */
function numberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** The board's rows: one per symbol, alphabetically, with rows that carry no price dropped. */
export function parseBoard(payload: unknown): BoardRow[] {
  const response = (payload as { response?: unknown } | null)?.response;
  if (!Array.isArray(response)) return [];

  const bySymbol = new Map<string, BoardRow>();
  for (const raw of response as Record<string, unknown>[]) {
    const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
    const price = numberOrNull(raw.price);
    // No symbol, or no price: nothing to track and nothing to record. Never invent a level.
    if (!symbol || price === null) continue;
    if (bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, {
      symbol,
      price,
      change: numberOrNull(raw.change),
      changePercent: numberOrNull(raw.changePercentage),
      volume: numberOrNull(raw.volume),
      at: typeof raw.date === 'string' ? raw.date : null,
    });
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Milliseconds until the next `hour` o'clock in Karachi.
 *
 * Karachi is UTC+5 all year — no daylight saving — so 02:00 there is 21:00 UTC on the previous UTC
 * day. Getting that shift wrong would run the pass eight hours late, so it is computed here rather
 * than assumed at the call site, and it is covered by tests.
 */
export function msUntilNextRun(now: Date, hour = 2): number {
  const utcHour = (((hour - 5) % 24) + 24) % 24;
  const dayShift = hour - 5 < 0 ? -1 : 0;
  const target = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayShift, utcHour, 0, 0, 0,
  ));
  // Step forward until the target is in the future. The UTC-day shift above leaves it a day in the
  // past for most of the day, and stepping only once would schedule the pass in the past — which a
  // timer fires immediately rather than ~23 hours later.
  while (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now.getTime();
}

async function fetchBoard(): Promise<unknown> {
  const res = await fetch(BOARD_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://sarmaaya.pk/' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`board -> HTTP ${res.status}`);
  return res.json();
}

/**
 * One pass: read the board, register anything untracked, queue every symbol for a refresh.
 *
 * Re-runnable and idempotent — a symbol already tracked is not touched here, and the sync it is
 * queued for writes under the session stamp, so a second pass in the same day rewrites nothing.
 */
export async function runDailyBoard(opts: { pacingMs?: number } = {}): Promise<DailyBoardSummary> {
  const log = childLogger({ job: 'daily_board' });
  const board = parseBoard(await fetchBoard());
  if (board.length === 0) throw new Error('board returned no rows — refusing to treat that as "no stocks"');

  const tracked = new Set(
    (await prisma.stock.findMany({ select: { symbol: true } })).map((row) => row.symbol.toUpperCase()),
  );
  // Symbols a human removed are neither registered nor refreshed, however the board reports them.
  const removed = await deletedSymbolRepository.all();

  const registered: string[] = [];
  for (const row of board) {
    if (tracked.has(row.symbol) || removed.has(row.symbol)) continue;
    try {
      await stockRepository.create(row.symbol);
      registered.push(row.symbol);
      tracked.add(row.symbol);
    } catch {
      // Lost a race with the universe pass between the read and the insert: it is tracked now,
      // which is the only thing this loop is for.
    }
  }

  const pacing = opts.pacingMs ?? 120;
  let queued = 0;
  let failed = 0;
  for (const [i, row] of board.entries()) {
    if (removed.has(row.symbol)) continue;
    try {
      await enqueueSync(row.symbol, 'cron');
      queued++;
    } catch (error) {
      failed++;
      log.warn('daily_board.enqueue_failed', { symbol: row.symbol, error: (error as Error).message });
    }
    if (i < board.length - 1) await new Promise((r) => setTimeout(r, pacing));
  }

  log.info('daily_board.done', { fetched: board.length, registered: registered.length, queued, failed });
  return { fetched: board.length, registered, queued, failed };
}
