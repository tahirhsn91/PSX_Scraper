/**
 * The product events this app records (#212).
 *
 * The catalogue is closed on purpose: an event name or property that is not listed here is rejected,
 * so instrumentation cannot quietly grow into a behavioural-tracking system.
 *
 * **What is deliberately absent**
 * - No search text and no symbol. `search_submitted` records whether the search found anything and
 *   how many results, not what was typed; `stock_viewed` has no properties at all. Which stocks a
 *   person looked at is their business, and nothing in the product needs it.
 * - No IP address, user agent, cookie, referrer, device id or geographic field is stored. Rows carry
 *   the event name, the route path (no query string), the whitelisted properties, and a timestamp.
 *   Without an identifier there is no unique-visitor metric — that is the trade, taken knowingly.
 * - No session or user correlation: several events from the same browser cannot be joined.
 *
 * Collection is disabled with `ANALYTICS_ENABLED=false`; the endpoint then accepts the payload and
 * stores nothing, so a client that still fires events does not get errors in its console.
 */

export const EVENT_PROPS = {
  /** A search was submitted. `resultCount` and `hadResults` only — never the query. */
  search_submitted: ['resultCount', 'hadResults'],
  /** A result was chosen from the list. `position` is its 0-based index. */
  search_result_selected: ['position'],
  /** A stock page was opened. No symbol: see the note above. */
  stock_viewed: [],
  /** A screener filter was applied. `filter` names which control. */
  screener_filter_applied: ['filter'],
  /** A comparison was built. `symbols` is how many, `period` the range. */
  compare_created: ['symbols', 'period'],
  /** The chart range was changed. `range` is one of the app's own range keys. */
  chart_timeframe_changed: ['range'],
  /** An announcement was opened. `category` is its mapped category. */
  announcement_opened: ['category'],
  /** A watchlist entry was added or removed. */
  watchlist_changed: ['action'],
} as const;

export type EventName = keyof typeof EVENT_PROPS;

export const EVENT_NAMES = Object.keys(EVENT_PROPS) as EventName[];

export function isEventName(name: string): name is EventName {
  return (EVENT_NAMES as string[]).includes(name);
}

export function allowedProps(name: EventName): readonly string[] {
  return EVENT_PROPS[name];
}

/** Retention: the summary never reads past this window, and `prune` uses the same number. */
export const EVENT_RETENTION_DAYS = 90;

export function analyticsEnabled(): boolean {
  // Unset means enabled: the flag exists to turn collection off, not to opt a deployment in.
  return (process.env.ANALYTICS_ENABLED ?? 'true').toLowerCase() !== 'false';
}
