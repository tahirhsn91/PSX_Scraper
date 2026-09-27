import { prisma } from '../database/prisma';
import { childLogger } from '../utils/logger';
import { fetchPsxHolidays, SOURCE } from '../scrapers/psxHolidays.scraper';

/**
 * The exchange's trading calendar: which days a session can exist on at all.
 *
 * The rule it replaces was "Monday-Friday" (`utils/marketHours.ts`), which cannot tell a trading
 * Wednesday from a holiday Wednesday. Two dates make the cost of that concrete: 2026-08-26 was
 * written as a session (441 rows, `volume = 0`, the previous close carried forward), and PSX's own
 * published list calls 2026-08-25 - a Tuesday the market demonstrably traded - the Eid holiday.
 * So the calendar here is *corroboration*: `tradingDayState` reports a weekend, a listed holiday,
 * or `unknown` when the calendar cannot be read, and callers decide. Nothing in this module
 * invents a session, and nothing treats a listed holiday as proof the market closed.
 */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

export type TradingDayState = 'trading' | 'holiday' | 'weekend' | 'unknown';

export interface HolidayRow {
  date: string;
  name: string;
  days: number | null;
  partial: boolean;
}

/** The calendar day in Karachi - the day a PSX session is stamped with. */
export function pktDay(date: Date): string {
  const pkt = new Date(date.getTime() + PKT_OFFSET_MS);
  return `${pkt.getUTCFullYear()}-${String(pkt.getUTCMonth() + 1).padStart(2, '0')}-${String(pkt.getUTCDate()).padStart(2, '0')}`;
}

/** PSX trades Monday-Friday. The weekday is read on the PKT wall clock, not on UTC. */
export function isWeekend(date: Date): boolean {
  const day = new Date(date.getTime() + PKT_OFFSET_MS).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * What the calendar says about a day, given what `holidayOn` returned for it.
 *
 * `undefined` means the calendar could not be read at all - distinct from `null`, which means it
 * was read and the day is not on it. Callers must treat `unknown` as "no evidence", not as
 * "closed": a calendar outage must not be able to silently skip a real session.
 */
export function classifyTradingDay(
  date: Date,
  holiday: Pick<HolidayRow, 'partial'> | null | undefined,
): TradingDayState {
  if (isWeekend(date)) return 'weekend';
  if (holiday === undefined) return 'unknown';
  if (holiday !== null && !holiday.partial) return 'holiday';
  return 'trading';
}

/** A listed holiday that applies to one community only is not a market-wide closure. */
const cache = new Map<string, HolidayRow | null>();

/** Years whose holiday set has been read, so a date that is absent is absent on purpose. */
const loadedYears = new Set<number>();

/** A failed read is retried no more than once a minute, per process. */
let cooldownUntil = 0;
const COOLDOWN_MS = 60_000;

export function clearHolidayCache(): void {
  cache.clear();
  loadedYears.clear();
  cooldownUntil = 0;
}

export interface HolidayRefreshStats {
  source: string;
  fetched: number;
  inserted: number;
  updated: number;
}

/** Read PSX's published list and store it. Idempotent: a re-run updates rather than duplicates. */
export async function refreshMarketHolidays(): Promise<HolidayRefreshStats> {
  const log = childLogger({ op: 'market-calendar' });
  const holidays = await fetchPsxHolidays();

  let inserted = 0;
  let updated = 0;
  for (const holiday of holidays) {
    const date = new Date(`${holiday.date}T00:00:00.000Z`);
    const existing = await prisma.marketHoliday.findUnique({ where: { date }, select: { id: true } });
    const fields = {
      name: holiday.name,
      days: holiday.days,
      partial: holiday.partial,
      source: SOURCE,
    };
    if (existing) {
      await prisma.marketHoliday.update({ where: { date }, data: fields });
      updated += 1;
    } else {
      await prisma.marketHoliday.create({ data: { date, ...fields } });
      inserted += 1;
    }
  }

  clearHolidayCache();
  log.info('market-calendar.refreshed', { fetched: holidays.length, inserted, updated, source: SOURCE });
  return { source: SOURCE, fetched: holidays.length, inserted, updated };
}

/**
 * Seed an empty calendar at boot. A gate with no calendar falls back to the weekday rule, which is
 * the rule this module exists to sharpen, so an empty table must not outlive the first boot.
 */
export async function ensureMarketHolidaysSeeded(): Promise<{ seeded: boolean; count: number }> {
  const count = await prisma.marketHoliday.count();
  if (count > 0) return { seeded: false, count };
  const stats = await refreshMarketHolidays();
  return { seeded: stats.inserted > 0, count: stats.inserted };
}

async function loadYear(year: number): Promise<boolean> {
  loadedYears.add(year);
  if (Date.now() < cooldownUntil) {
    loadedYears.delete(year);
    return false;
  }
  try {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const rows = await prisma.marketHoliday.findMany({
      where: { date: { gte: from, lt: to } },
      select: { date: true, name: true, days: true, partial: true },
    });
    for (const row of rows) {
      cache.set(row.date.toISOString().slice(0, 10), {
        date: row.date.toISOString().slice(0, 10),
        name: row.name,
        days: row.days,
        partial: row.partial,
      });
    }
    return true;
  } catch (err) {
    loadedYears.delete(year);
    cooldownUntil = Date.now() + COOLDOWN_MS;
    childLogger({ op: 'market-calendar' }).warn('market-calendar.unreadable', {
      year,
      error: (err as Error).message.slice(0, 120),
    });
    return false;
  }
}

/** The stored holiday for a day, `null` when the day is not on the list, `undefined` if unreadable. */
export async function holidayOn(date: Date): Promise<HolidayRow | null | undefined> {
  const day = pktDay(date);
  const year = Number(day.slice(0, 4));
  if (!loadedYears.has(year)) {
    const ok = await loadYear(year);
    if (!ok) return undefined;
  }
  return cache.get(day) ?? null;
}

/** What the calendar says about `date`. See `classifyTradingDay` for what `unknown` means. */
export async function tradingDayState(date: Date): Promise<TradingDayState> {
  return classifyTradingDay(date, await holidayOn(date));
}
