/**
 * How fresh a dataset is, decided once and shared by the API.
 *
 * The classification is deliberately *not* a timestamp comparison alone: a reading taken at 15:30
 * yesterday is not stale on Saturday morning, and a reading taken ten minutes ago during a session
 * is not "live". So the rule needs three facts — when the reading was taken, where the clock sits
 * in the session, and which session the newest stored data actually covers — and it returns a word
 * instead of leaving every client to invent its own.
 *
 * `delayed` exists because a feed can lag inside a session without being broken; it is the honest
 * label for a reading older than the live window but newer than the stale one. Nothing here claims
 * a source is real-time: `live` means "we read it recently", which is all a scraper can know.
 */

export type DatasetStatus = 'live' | 'delayed' | 'end-of-day' | 'stale' | 'unavailable';

/** A reading older than this during a session is no longer "live". */
export const LIVE_WITHIN_MS = 5 * 60 * 1000;

/** ...and older than this is stale rather than merely delayed. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

/** Dividends change when a company declares one, not per session; a week is "current" here. */
export const EVENT_CURRENT_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

export interface IntradayInput {
  asOf: Date | null;
  now: Date;
  /** True only when the exchange is genuinely in session (a listed holiday is not open). */
  open: boolean;
  /** PKT date ("2026-10-17") of the newest stored session, if any. */
  lastSessionDate: string | null;
  /** PKT date helper, injected so tests do not depend on the process timezone. */
  dayOf: (date: Date) => string;
  liveWithinMs?: number;
  staleAfterMs?: number;
}

/**
 * Freshness of a reading that is meant to move during the session (quotes, index levels).
 *
 * While closed, age is the wrong question — the last session's close stays the last session's
 * close until the next one opens. So closed readings are judged by the session they cover:
 * the newest session's data is `end-of-day`, anything older is `stale`.
 */
export function classifyIntraday(input: IntradayInput): DatasetStatus {
  const { asOf, now, open, lastSessionDate, dayOf } = input;
  if (!asOf) return 'unavailable';

  const age = now.getTime() - asOf.getTime();
  // A stamp in the future is a clock disagreement, not old data; treat it as current rather than
  // painting the whole dashboard red over a few seconds of skew between host and database.
  if (age < 0) return 'live';

  if (open) {
    if (age <= (input.liveWithinMs ?? LIVE_WITHIN_MS)) return 'live';
    if (age <= (input.staleAfterMs ?? STALE_AFTER_MS)) return 'delayed';
    return 'stale';
  }

  if (lastSessionDate && dayOf(asOf) < lastSessionDate) return 'stale';
  return 'end-of-day';
}

export interface DailyInput {
  asOf: Date | null;
  lastSessionDate: string | null;
  dayOf: (date: Date) => string;
}

/**
 * Freshness of a series that lands once per session (daily candles). It is current when it covers
 * the newest session we know about, and stale when it stops short of it — a Friday file on Monday
 * is exactly the failure this is meant to make visible.
 */
export function classifyDaily(input: DailyInput): DatasetStatus {
  const { asOf, lastSessionDate, dayOf } = input;
  if (!asOf) return 'unavailable';
  if (lastSessionDate && dayOf(asOf) < lastSessionDate) return 'stale';
  return 'end-of-day';
}

/**
 * Freshness of event data (dividends): not session-bound at all, so it is current for a week and
 * stale afterwards. Never `live`: a dividend calendar is not a live feed, and saying so would be a
 * claim the source cannot support.
 */
export function classifyEvent(asOf: Date | null, now: Date): DatasetStatus {
  if (!asOf) return 'unavailable';
  const age = now.getTime() - asOf.getTime();
  if (age < 0) return 'end-of-day';
  return age <= EVENT_CURRENT_WITHIN_MS ? 'end-of-day' : 'stale';
}
