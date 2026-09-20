import { prisma } from '../database/prisma';
import { fetchDailyBars, type DailyBar } from '../scrapers/yahoo.scraper';
import { candleDay } from '../repositories/stockDetail.repository';
import { sessionStamp } from '../scrapers/parse.utils';

/**
 * Fills in daily candle history for a symbol from Yahoo, without ever duplicating or
 * overwriting what we already hold.
 *
 * The rules, all of them deliberate:
 *
 *  - A session we already have is *not* rewritten. Existing values stay as they are: where the
 *    DPS-era row carries an official close, that close survives even if Yahoo reports something
 *    slightly different after a later adjustment.
 *  - A session with a *gap* is completed field by field. Our DPS rows have no high/low at all,
 *    and that is exactly what Yahoo supplies — so a year of FFC candles becomes complete
 *    instead of body-less.
 *  - A session with nothing missing is skipped outright, so re-running this is cheap and the
 *    database does not accumulate redundant rows ("do not store redundant data if the
 *    historical record already exists").
 *  - Rows are keyed to the session the same way the live pipeline keys them — 16:00 PKT,
 *    via the same `sessionStamp` rule — so a backfilled day merges into the candle the live
 *    poll already wrote for it rather than becoming a second one. (Two rows for one session is
 *    a bug this codebase has already paid for once.)
 */
export interface BackfillStats {
  symbol: string;
  barsFetched: number;
  inserted: number;
  filled: number;
  skipped: number;
}

/** What the database already holds for one session, as plain numbers. */
export interface ExistingCandle {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface UpdatePlan {
  action: 'insert' | 'fill' | 'skip';
  /** Only the fields that are missing locally and present remotely. */
  fields: Partial<ExistingCandle>;
}

const FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;

/**
 * What to do with one incoming bar. Pure, so the "don't rewrite, don't duplicate" promise is
 * testable without a database.
 */
export function planUpdate(existing: ExistingCandle | null, bar: DailyBar): UpdatePlan {
  if (!existing) return { action: 'insert', fields: {} };
  const fields: Partial<ExistingCandle> = {};
  for (const key of FIELDS) {
    const incoming = bar[key];
    const have = existing[key];
    if (incoming !== null && (have === null || have === undefined)) fields[key] = incoming;
  }
  return Object.keys(fields).length > 0 ? { action: 'fill', fields } : { action: 'skip', fields: {} };
}

/**
 * The session stamp for a known trading day: 16:00 PKT, i.e. 11:00 UTC. Identical to what
 * `sessionStamp` produces for that date, which is what keeps backfilled rows and live rows on
 * the same key.
 */
export function sessionStampFor(date: string): Date {
  return new Date(`${date}T11:00:00.000Z`);
}

function toNumOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** One symbol: fetch its full daily history and fill in whatever we are missing. */
export async function backfillSymbol(symbol: string): Promise<BackfillStats> {
  const sym = symbol.trim().toUpperCase();
  const stock = await prisma.stock.findUnique({ where: { symbol: sym }, select: { id: true } });
  if (!stock) throw new Error(`not tracked: ${sym}`);

  const bars = await fetchDailyBars(sym);
  const rows = await prisma.stockPrice.findMany({
    where: { stockId: stock.id },
    select: { id: true, lastTradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  });
  const byDay = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.lastTradeDate) byDay.set(candleDay(r.lastTradeDate), r);
  }

  const stats: BackfillStats = { symbol: sym, barsFetched: bars.length, inserted: 0, filled: 0, skipped: 0 };
  for (const bar of bars) {
    const row = byDay.get(bar.date) ?? null;
    const existing: ExistingCandle | null = row
      ? {
          open: toNumOrNull(row.open),
          high: toNumOrNull(row.high),
          low: toNumOrNull(row.low),
          close: toNumOrNull(row.close),
          volume: toNumOrNull(row.volume),
        }
      : null;
    const plan = planUpdate(existing, bar);
    if (plan.action === 'skip') {
      stats.skipped += 1;
      continue;
    }
    const volume = bar.volume === null ? undefined : BigInt(Math.round(bar.volume));
    if (plan.action === 'insert') {
      await prisma.stockPrice.create({
        data: {
          stockId: stock.id,
          lastTradeDate: sessionStampFor(bar.date),
          open: bar.open ?? undefined,
          high: bar.high ?? undefined,
          low: bar.low ?? undefined,
          // `close` is the EOD value; `currentPrice` is deliberately left alone — it belongs to
          // the live pipeline and must stay the freshest reading.
          close: bar.close,
          volume,
        },
      });
      stats.inserted += 1;
    } else {
      await prisma.stockPrice.update({
        where: { id: row!.id },
        data: {
          open: plan.fields.open ?? undefined,
          high: plan.fields.high ?? undefined,
          low: plan.fields.low ?? undefined,
          close: plan.fields.close ?? undefined,
          volume: plan.fields.volume == null ? undefined : BigInt(Math.round(plan.fields.volume)),
        },
      });
      stats.filled += 1;
    }
  }
  return stats;
}

/** Guards the session-stamp rule against drift: both paths must agree on a given date. */
export function assertStampMatchesSessionRule(date: string): void {
  const viaHelper = sessionStamp(date);
  const viaBackfill = sessionStampFor(date).toISOString();
  if (viaHelper !== viaBackfill) {
    throw new Error(`session stamp mismatch for ${date}: ${viaHelper} vs ${viaBackfill}`);
  }
}
