/**
 * PSX trading session: Monday–Friday, 09:30–15:30 PKT.
 *
 * Pakistan has no daylight saving, so PKT is a fixed UTC+5 — no timezone database needed.
 *
 * The quote poll deliberately runs a little wide of the session: from 09:25 so the opening
 * print is picked up straight away, to 15:35 so the closing auction has settled. Outside
 * that window the DPS series returns the values it already returned, so polling there is
 * load for no new data (288 ticks/day instead of ~74).
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Session window defaults, as minutes past midnight PKT. */
const DEFAULT_OPEN_MINUTES = 9 * 60 + 25; // 09:25
const DEFAULT_CLOSE_MINUTES = 15 * 60 + 35; // 15:35

export interface SessionWindow {
  openMinutes?: number;
  closeMinutes?: number;
}

/**
 * Whether the exchange is in (or just around) a trading session at `now`.
 *
 * `now` is an instant; the weekday and clock time are evaluated on the PKT wall clock, so
 * a tick at 22:00 UTC on a Friday correctly reports closed (03:00 Saturday in Karachi).
 */
export function isMarketOpen(now: Date, window: SessionWindow = {}): boolean {
  const open = window.openMinutes ?? DEFAULT_OPEN_MINUTES;
  const close = window.closeMinutes ?? DEFAULT_CLOSE_MINUTES;

  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const day = pkt.getUTCDay();
  if (day === 0 || day === 6) return false;

  const minutes = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
  return minutes >= open && minutes <= close;
}
