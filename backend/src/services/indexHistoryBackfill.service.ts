import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { assertStampMatchesSessionRule, sessionStampFor } from './candleBackfill.service';

/**
 * Index history from Sarmaaya's public API, which carries each index back to its own inception —
 * 2010-04 for KSE100, later for indices that only started then. Used to backfill the sessions the
 * exchange's own series never gave us.
 *
 * It writes **nothing** over a session we already hold: an insert-only path, so a level we
 * collected live from the exchange is never replaced by a historical reading that differs in the
 * last paisa.
 */

export interface IndexPoint {
  date: string;
  value: number;
  volume: number | null;
}

export interface IndexBackfillStats {
  symbol: string;
  fetched: number;
  inserted: number;
  alreadyHeld: number;
  error?: string;
}

const SOURCE = 'https://beta-restapi.sarmaaya.pk/api/indices';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** The API wraps its payload as {success, message, response: [...]}. Anything else yields nothing. */
function rowsOf(payload: unknown): Record<string, unknown>[] {
  const response = (payload as { response?: unknown } | null)?.response;
  return Array.isArray(response) ? (response as Record<string, unknown>[]) : [];
}

/**
 * A number, or NaN for anything that is not one.
 *
 * `Number(null)` is 0, so a null price would otherwise be written as a level of zero — a
 * fabricated bar. Absent values must never be coerced into a real reading.
 */
function numberOrNaN(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return NaN;
  return Number(raw);
}

function dayOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Join the price and volume series into one point per session.
 *
 * A point whose price is missing or unreadable is dropped rather than written: `value` is required
 * on the model, and a row with no level would be a fabricated bar. The first reading of a date
 * wins, and the result is oldest-first.
 */
export function parseIndexHistory(pricePayload: unknown, volumePayload: unknown): IndexPoint[] {
  const volumes = new Map<string, number | null>();
  for (const row of rowsOf(volumePayload)) {
    const date = dayOf(row.date);
    if (!date) continue;
    const raw = numberOrNaN(row.volume);
    volumes.set(date, Number.isFinite(raw) ? Math.trunc(raw) : null);
  }

  const byDay = new Map<string, IndexPoint>();
  for (const row of rowsOf(pricePayload)) {
    const date = dayOf(row.date);
    const value = numberOrNaN(row.price);
    if (!date || !Number.isFinite(value)) continue;
    if (byDay.has(date)) continue;
    byDay.set(date, { date, value, volume: volumes.get(date) ?? null });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Only the sessions we do not already hold — an existing session is never rewritten. */
export function planIndexInserts(existing: Iterable<string>, points: IndexPoint[]): IndexPoint[] {
  const have = new Set(existing);
  return points.filter((point) => !have.has(point.date));
}

/** The exchange calendar day a stored row belongs to. Our rows are stamped 11:00 UTC (16:00 PKT). */
export function storedDay(tradeDate: Date): string {
  return new Date(tradeDate.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function fetchSeries(path: string): Promise<unknown> {
  const res = await fetch(`${SOURCE}/${path}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://sarmaaya.pk/' },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

export async function backfillIndex(symbol: string, opts: { days?: number; dryRun?: boolean } = {}): Promise<IndexBackfillStats> {
  const sym = symbol.trim().toUpperCase();
  const index = await prisma.marketIndex.findFirst({ where: { symbol: sym }, select: { id: true } });
  if (!index) throw new Error(`index not tracked: ${sym}`);

  const days = opts.days ?? 6000;
  const [prices, volumes] = await Promise.all([
    fetchSeries(`price-history/${sym}?days=${days}`),
    fetchSeries(`volume-history/${sym}?days=${days}`),
  ]);
  const points = parseIndexHistory(prices, volumes);

  // Assert the convention this writes under, exactly as the stock backfill does: if the two
  // session-stamp helpers ever drift apart, this fails before a single row is written.
  for (const point of points) assertStampMatchesSessionRule(point.date);

  const held = await prisma.indexValue.findMany({ where: { indexId: index.id }, select: { tradeDate: true } });
  const existing = held.map((row) => storedDay(row.tradeDate));
  const toInsert = planIndexInserts(existing, points);

  if (!opts.dryRun && toInsert.length > 0) {
    await prisma.indexValue.createMany({
      data: toInsert.map((point) => ({
        indexId: index.id,
        tradeDate: sessionStampFor(point.date),
        value: new Prisma.Decimal(point.value),
        volume: point.volume === null ? null : BigInt(point.volume),
      })),
      skipDuplicates: true,
    });
  }

  return {
    symbol: sym,
    fetched: points.length,
    inserted: opts.dryRun ? 0 : toInsert.length,
    alreadyHeld: points.length - toInsert.length,
  };
}

/** Every tracked index, one at a time, politely. Re-runnable: a second pass inserts nothing. */
export async function backfillAllIndices(opts: { days?: number; pacingMs?: number } = {}) {
  const indices = await prisma.marketIndex.findMany({ select: { symbol: true }, orderBy: { symbol: 'asc' } });
  const results: IndexBackfillStats[] = [];
  const pacing = opts.pacingMs ?? 300;

  for (const [i, index] of indices.entries()) {
    try {
      results.push(await backfillIndex(index.symbol, { days: opts.days }));
    } catch (error) {
      results.push({ symbol: index.symbol, fetched: 0, inserted: 0, alreadyHeld: 0, error: (error as Error).message });
    }
    if (i < indices.length - 1) await new Promise((r) => setTimeout(r, pacing));
  }

  return {
    indices: results.length,
    fetched: results.reduce((sum, r) => sum + r.fetched, 0),
    inserted: results.reduce((sum, r) => sum + r.inserted, 0),
    failed: results.filter((r) => r.error).length,
    results,
  };
}
