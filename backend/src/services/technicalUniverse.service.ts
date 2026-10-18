import { prisma } from '../database/prisma';
import { rsi, sma } from './indicators.service';

/**
 * RSI and moving averages for the whole board.
 *
 * The screener must not re-derive technicals in its own SQL or in the browser: #202's engine is the
 * single definition of "RSI(14)", and a filter that disagrees with the stock page by a tenth is
 * worse than no filter. So this reads the closes once and runs the *same* functions the endpoint
 * uses. The filter, the column and the detail page then agree by construction.
 *
 * Two performance decisions that matter:
 *
 * 1. **One row per stock, not one per session.** A plain findMany over a 500-day window returns
 *    ~166k rows, and Prisma spends ~9 s decoding them into objects. `array_agg` in Postgres hands
 *    back 511 rows of float8 arrays instead (~300 ms), and the maths runs on those.
 * 2. **Stale-while-revalidate.** A TTL alone would make one request every five minutes pay the
 *    rebuild. Instead the cached board is returned immediately and, once it is older than the TTL,
 *    a rebuild runs in the background — no request waits for it after the first.
 *
 * Window: 500 calendar days before the latest stored session — the same lookback the indicator
 * endpoint applies. Wilder smoothing is recursive, so a shorter window yields a *different* number
 * rather than a cheaper version of the same one.
 */

export interface TechnicalRow {
  rsi: number | null;
  sma50: number | null;
  sma200: number | null;
  /** Sessions available in the window; the reason a row can be excluded. */
  sessions: number;
  /** Latest stored close, so the moving-average relation is judged against the same price. */
  close: number;
}

export interface Universe {
  rows: Map<string, TechnicalRow>;
  /** Stocks with too little history to judge, and the threshold they missed. */
  excluded: number;
  minimumSessions: number;
  windowStart: string | null;
  windowEnd: string | null;
  latestSession: string | null;
}

const LOOKBACK_DAYS = 500;
const MIN_SESSIONS = 50; // enough for SMA(50); SMA(200)/RSI(14) are null below their own thresholds
const TTL_MS = 5 * 60 * 1000;

let cache: { value: Universe; at: number } | null = null;
let building: Promise<Universe> | null = null;

const iso = (d: Date) => d.toISOString().slice(0, 10);

interface AggregateRow {
  stock_id: string;
  closes: number[];
  first_date: string;
  last_date: string;
}

async function buildUniverse(): Promise<Universe> {
  const latest = await prisma.$queryRaw<Array<{ latest: Date | null }>>`
    SELECT MAX(last_trade_date) AS latest FROM stock_prices WHERE close IS NOT NULL
  `;
  const latestDate = latest[0]?.latest ?? null;
  if (!latestDate) {
    return {
      rows: new Map(),
      excluded: 0,
      minimumSessions: MIN_SESSIONS,
      windowStart: null,
      windowEnd: null,
      latestSession: null,
    };
  }

  const from = new Date(latestDate);
  from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS);

  // One close per stock *per session date*. `last_trade_date` is a timestamp and a synced day can
  // carry several snapshots (1,717 stock-days do), so a plain aggregate would feed the indicator
  // duplicate closes — three identical 931.52 entries in a row shift Wilder's average measurably
  // and make the filter disagree with the stock page. DISTINCT ON keeps the day's last snapshot,
  // which is what the chart's own candle builder does.
  const agg = await prisma.$queryRaw<AggregateRow[]>`
    SELECT
      stock_id,
      ARRAY_AGG(close ORDER BY d) AS closes,
      MIN(d)::text AS first_date,
      MAX(d)::text AS last_date
    FROM (
      SELECT DISTINCT ON (stock_id, last_trade_date::date)
        stock_id,
        last_trade_date::date AS d,
        close::float8 AS close
      FROM stock_prices
      WHERE last_trade_date >= ${from} AND close IS NOT NULL
      ORDER BY stock_id, last_trade_date::date, last_trade_date DESC
    ) per_day
    GROUP BY stock_id
  `;

  const rows = new Map<string, TechnicalRow>();
  let excluded = 0;
  let windowStart: string | null = null;
  let windowEnd: string | null = null;

  for (const r of agg) {
    const closes = r.closes ?? [];
    const sessions = closes.length;
    if (sessions < MIN_SESSIONS) {
      excluded += 1;
      continue;
    }
    const rsiPoints = rsi(closes, 14);
    const sma50Points = sma(closes, 50);
    const sma200Points = sma(closes, 200);
    rows.set(r.stock_id, {
      rsi: rsiPoints[rsiPoints.length - 1] ?? null,
      sma50: sma50Points[sma50Points.length - 1] ?? null,
      sma200: sma200Points[sma200Points.length - 1] ?? null,
      sessions,
      close: closes[closes.length - 1] ?? 0,
    });
    if (!windowStart || r.first_date < windowStart) windowStart = r.first_date;
    if (!windowEnd || r.last_date > windowEnd) windowEnd = r.last_date;
  }

  return {
    rows,
    excluded,
    minimumSessions: MIN_SESSIONS,
    windowStart,
    windowEnd,
    latestSession: iso(latestDate),
  };
}

/** Builds the universe, or returns the cached one immediately. */
export async function technicalUniverse(): Promise<Universe> {
  if (!cache) {
    building = building ?? buildUniverse();
    const value = await building;
    cache = { value, at: Date.now() };
    building = null;
    return value;
  }

  // Serve the cached board; refresh it out of band once it is past its TTL. A failure here must
  // not take the screener down — the previous board is still a valid answer one session stale.
  if (Date.now() - cache.at > TTL_MS && !building) {
    building = buildUniverse()
      .then((value) => {
        cache = { value, at: Date.now() };
        return value;
      })
      .catch(() => cache!.value)
      .finally(() => {
        building = null;
      });
  }
  return cache.value;
}

/** Testing seam: forget the cached board (used by the unit test and after a sync). */
export function clearTechnicalUniverse(): void {
  cache = null;
  building = null;
}

export type MaRelation = 'above_sma50' | 'below_sma50' | 'above_sma200' | 'below_sma200';

export interface TechnicalCriteria {
  minRsi?: number;
  maxRsi?: number;
  maRelation?: MaRelation;
}

/** True when a row satisfies every supplied criterion; a null value never satisfies a bound. */
export function matchesTechnical(row: TechnicalRow, close: number | null, c: TechnicalCriteria): boolean {
  if (c.minRsi != null && (row.rsi == null || row.rsi < c.minRsi)) return false;
  if (c.maxRsi != null && (row.rsi == null || row.rsi > c.maxRsi)) return false;
  if (c.maRelation) {
    const [side, which] = c.maRelation.split('_') as ['above' | 'below', 'sma50' | 'sma200'];
    const ma = row[which];
    if (close == null || ma == null) return false;
    if (side === 'above' ? close <= ma : close >= ma) return false;
  }
  return true;
}
