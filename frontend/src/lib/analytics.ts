/**
 * First-party product events (#212).
 *
 * `sendBeacon` so an event still leaves when the click is already navigating away. The payload is
 * the event name, the current route path (no query string) and whitelisted properties — never the
 * typed query, never a symbol, never an identifier. The backend rejects anything outside its
 * catalogue, so this list and `backend/src/analytics/events.ts` must agree.
 *
 * Failure is silent by design: analytics must never break a page or show a console error.
 */
export type EventName =
  | 'search_submitted'
  | 'search_result_selected'
  | 'stock_viewed'
  | 'screener_filter_applied'
  | 'compare_created'
  | 'chart_timeframe_changed'
  | 'announcement_opened'
  | 'watchlist_changed';

type Props = Record<string, string | number | boolean>;

const ENDPOINT = `${(import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '')}/analytics/events`;

/**
 * The route with identifiers removed: `/stocks/OGDC` is sent as `/stocks/:symbol`.
 *
 * Without this the path would say which stock someone opened, which is exactly what the event
 * properties are not allowed to say.
 */
function routeTemplate(pathname: string): string {
  return pathname.replace(/^\/stocks\/[^/]+/, '/stocks/:symbol').slice(0, 120);
}

export function track(name: EventName, props?: Props): void {
  try {
    const body = JSON.stringify({ name, path: routeTemplate(window.location.pathname), props });
    // `fetch` with `keepalive`, not `sendBeacon`: beacon requests are credentialed, and the API's
    // CORS policy does not allow credentials, so the browser refused the preflight. Analytics needs
    // no credentials at all, and `keepalive` still lets the request survive the navigation.
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* never let instrumentation break the page */
  }
}
