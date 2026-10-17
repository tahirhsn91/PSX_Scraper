import { marketStatusRepository } from '../repositories/marketStatus.repository';
import { pktDay, tradingDayState } from './marketCalendar.service';
import { isMarketOpen, sessionPhase } from '../utils/marketHours';
import {
  classifyDaily,
  classifyEvent,
  classifyIntraday,
  type DatasetStatus,
} from '../utils/datasetFreshness';

/**
 * "What is this screen showing, and how old is it?"
 *
 * One endpoint answers for the whole app so that five surfaces cannot each invent their own idea
 * of "stale". It reports two different things and keeps them separate on purpose:
 *
 * - **Session** — whether the exchange is open now, and which session the newest stored candle
 *   belongs to. This is what stops a weekend board from reading as a live one.
 * - **Dataset freshness** — for quotes, indices, candles and dividends, when the data was written
 *   and how that compares with the session. The thresholds live in `utils/datasetFreshness`, once.
 */

export type SessionLabel = 'open' | 'pre-open' | 'post-close' | 'weekend' | 'holiday';

export interface DatasetFreshness {
  /** ISO instant of the newest stored reading, or null when we hold nothing at all. */
  asOf: string | null;
  status: DatasetStatus;
  /** Who the data came from, in words a reader can act on ("PSX DPS · Sarmaaya"). */
  source: string;
  ageSeconds: number | null;
}

export interface MarketStatusPayload {
  now: string;
  /** The Karachi calendar day the app is reporting on. */
  marketDate: string;
  /** Newest session we hold candles for; null when the price table is empty. */
  lastSessionDate: string | null;
  session: 'open' | 'closed';
  sessionLabel: SessionLabel;
  datasets: {
    quotes: DatasetFreshness;
    indices: DatasetFreshness;
    candles: DatasetFreshness;
    dividends: DatasetFreshness;
  };
}

/** Source attribution per dataset — the same words the UI prints in its tooltip. */
const SOURCE = {
  quotes: 'PSX DPS · Sarmaaya',
  indices: 'PSX indices · Sarmaaya board',
  candles: 'PSX company pages',
  dividends: 'Sarmaaya fundamentals',
} as const;

const freshness = (
  asOf: Date | null,
  status: DatasetStatus,
  source: string,
  now: Date,
): DatasetFreshness => ({
  asOf: asOf ? asOf.toISOString() : null,
  status,
  source,
  ageSeconds: asOf ? Math.max(0, Math.round((now.getTime() - asOf.getTime()) / 1000)) : null,
});

/**
 * The session a reader means when they say "the last session".
 *
 * Deliberately answered by the calendar, not by `MAX(stock_prices.last_trade_date)`: the hourly
 * sync also writes a row on non-trading days (Saturday 2026-10-17 holds 511 rows whose volume is
 * Friday's, carried forward), so the newest row is not evidence that a session happened. Walking
 * back from today over the calendar is.
 *
 * Before the bell on a trading day, the last *completed* session is still the previous one; from
 * the 09:25 pre-open window onwards, today is the session being priced.
 */
async function lastSessionDay(
  now: Date,
  phase: 'pre' | 'open' | 'post',
  todayState: 'trading' | 'holiday' | 'weekend' | 'unknown',
): Promise<string | null> {
  const todayIsSession = phase !== 'pre' && todayState !== 'holiday' && todayState !== 'weekend';

  let day = todayIsSession ? new Date(now) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // Ten days covers a weekend plus the longest PSX holiday block we have on record (Eid).
  for (let i = 0; i < 10; i += 1) {
    const state = await tradingDayState(day);
    // `unknown` means the calendar could not be read; fall back to the weekday rule rather than
    // declaring the whole board stale on a calendar outage.
    if (state === 'trading' || state === 'unknown') return pktDay(day);
    day = new Date(day.getTime() - 24 * 60 * 60 * 1000);
  }
  return null;
}

export const marketStatusService = {
  async status(clock?: Date): Promise<MarketStatusPayload> {
    const now = clock ?? new Date();

    const [dayState, stamps] = await Promise.all([
      tradingDayState(now),
      marketStatusRepository.timestamps(),
    ]);

    // A listed holiday is closed even inside the 09:25–15:35 window: `isMarketOpen` only knows the
    // weekday, the calendar knows the day.
    const holiday = dayState === 'holiday';
    const open = !holiday && dayState !== 'weekend' && isMarketOpen(now);
    const phase = sessionPhase(now);

    const lastSessionDate = await lastSessionDay(now, phase, dayState);

    const sessionLabel: SessionLabel = holiday
      ? 'holiday'
      : dayState === 'weekend'
        ? 'weekend'
        : phase === 'pre'
          ? 'pre-open'
          : phase === 'open'
            ? 'open'
            : 'post-close';

    const intraday = (asOf: Date | null) =>
      classifyIntraday({ asOf, now, open, lastSessionDate, dayOf: pktDay });

    return {
      now: now.toISOString(),
      marketDate: pktDay(now),
      lastSessionDate,
      session: open ? 'open' : 'closed',
      sessionLabel,
      datasets: {
        quotes: freshness(stamps.quotesAt, intraday(stamps.quotesAt), SOURCE.quotes, now),
        indices: freshness(stamps.indicesAt, intraday(stamps.indicesAt), SOURCE.indices, now),
        candles: freshness(
          stamps.candlesAt,
          classifyDaily({ asOf: stamps.candlesAt, lastSessionDate, dayOf: pktDay }),
          SOURCE.candles,
          now,
        ),
        dividends: freshness(
          stamps.dividendsAt,
          classifyEvent(stamps.dividendsAt, now),
          SOURCE.dividends,
          now,
        ),
      },
    };
  },
};
