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

/** Below ±0.05% of the open a session is flat: coloured, it would claim a move that is not there. */
export const FLAT_BAND = 0.0005;

export interface MiniCandle {
  date: string;
  open: number;
  close: number;
  volume: number | null;
  /** The still-forming session — the index's newest reading. */
  live: boolean;
}

/** Newest-first rows → oldest-first candles, the way a chart reads. */
export function toCandles(rows: PriceRow[], sessions: number): MiniCandle[] {
  const window = [...rows].slice(0, sessions).reverse();
  const candles: MiniCandle[] = [];
  window.forEach((row, i) => {
    const close = row.close ?? row.currentPrice;
    if (close === null || close === undefined) return;
    const prev = i > 0 ? window[i - 1] : null;
    const prevClose = prev ? prev.close ?? prev.currentPrice : row.open;
    candles.push({
      date: row.lastTradeDate ?? '',
      open: row.open ?? prevClose ?? close,
      close,
      volume: row.volume,
      live: i === window.length - 1,
    });
  });
  return candles;
}

/** Which side of flat a session sits on, as a palette token for the caller to resolve. */
export function toneOf(candle: MiniCandle, flat: boolean) {
  const ref = candle.open === 0 ? candle.close : candle.open;
  const move = ref === 0 ? 0 : (candle.close - candle.open) / ref;
  if (flat || Math.abs(move) < FLAT_BAND) return 'text.disabled';
  return move > 0 ? 'success.main' : 'error.main';
}
