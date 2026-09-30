import type { PriceRow } from '../types';

/**
 * Turning an index's stored sessions into candles.
 *
 * Kept out of the component file on purpose: a module that exports both a component and a plain
 * function cannot be hot-swapped by the dev server ("Could not Fast Refresh"), so every edit to the
 * chart blanks the page until it reloads. The maths lives here; the drawing lives in the component.
 *
 * What the data does not have, these candles do not invent. The exchange publishes no high or low
 * for indices at all (the API returns null for both), so there are no wicks. The open is missing for
 * most sessions, so a session without one is built from the previous session's close to its own
 * close — the day's real net move — rather than from a made-up open.
 */

/**
 * Float noise, not policy: any session the index actually moved in is coloured, however small. This
 * was 0.0005 (0.05%), which greyed out real gains — KSE-100's +0.22% day among them.
 */
export const FLAT_BAND = 1e-9;

export interface MiniCandle {
  date: string;
  open: number;
  close: number;
  /** The previous session's close: what the exchange measures its change figure against. */
  prevClose: number | null;
  volume: number | null;
  /** The still-forming session — the index's newest reading. */
  live: boolean;
}

/**
 * Newest-first rows → oldest-first candles, the way a chart reads.
 *
 * Reads one row more than asked for, so the oldest candle in the window still knows the close it is
 * measured against, then drops that spare from the front. Without it the oldest candle would be the
 * only one toned against its own open.
 */
export function toCandles(rows: PriceRow[], sessions: number): MiniCandle[] {
  const window = [...rows].slice(0, sessions + 1).reverse();
  const candles: MiniCandle[] = [];
  window.forEach((row, i) => {
    const close = row.close ?? row.currentPrice;
    if (close === null || close === undefined) return;
    const prev = i > 0 ? window[i - 1] : null;
    const prevClose = prev ? prev.close ?? prev.currentPrice : null;
    candles.push({
      date: row.lastTradeDate ?? '',
      open: row.open ?? prevClose ?? close,
      close,
      prevClose,
      volume: row.volume,
      live: i === window.length - 1,
    });
  });
  return candles.slice(-sessions);
}

/**
 * Which side of flat a session sits on, as a palette token for the caller to resolve.
 *
 * Measured against the **previous session's close** — the same reference the exchange's own change
 * figure uses, and the same one the card prints beside the chart. Not against the session's open:
 * for KSE-100 on 30 Sep 2026 those two disagreed in sign. Open 170,041.98 → close 169,969.33 is
 * −0.04% (it opened higher and gave that back), while 169,600.40 → 169,969.33 is **+0.22%**, the
 * gain the board was quoting. Toning by the open drew a falling line for an index that rose, which
 * is why the card sat grey on a green day.
 *
 * Where a session has no previous close (the oldest in the window, on a short series) the open
 * stands in, so no candle is left without a tone.
 */
export function toneOf(candle: MiniCandle, flat: boolean) {
  const ref = candle.prevClose ?? candle.open;
  const move = ref === 0 ? 0 : (candle.close - ref) / ref;
  if (flat || Math.abs(move) < FLAT_BAND) return 'text.disabled';
  return move > 0 ? 'success.main' : 'error.main';
}
