import { logger } from '../utils/logger';
import { SCANNER_URL } from './marketCap.scraper';

/**
 * The session's daily candle — open, high, low, close, volume — from TradingView's public scanner,
 * one POST for the whole universe.
 *
 * Why this exists: the exchange's market-summary carousel carries a level, a change and a percent and
 * nothing else, and `dps.psx.com.pk` — whose time series did carry an open — is refused at the edge.
 * So the index `open` we stored was our own first observation inside a six-minute window
 * (`openingLevelFor`): a number *near* the session's first trade, not it. On 2026-09-28 it read
 * 170,944.02 where the session's real KSE-100 open was 170,991.1346.
 *
 * TradingView publishes the real candle for 11 of our 18 indices (HBLTTI, JSGBKTI, JSMFI, KSE100PR,
 * MII30, NBPPGI and NITPGI are not in its Pakistan universe) and for 485 of our 508 stocks — those
 * left out of its universe are almost all ETFs and preference shares. Its closes reconcile with ours
 * to the paisa on every symbol sampled, and its KSE-100 high and low match Sarmaaya's to the paisa,
 * which is the evidence that this is the same session the rest of the pipeline reads.
 *
 * Two things the caller must not skip — this module reads the source, the service decides what may be
 * written:
 *   - **A ticker is not a contract.** TradingView's `PSX:OGTI` is not the exchange's OGTI: its candle
 *     closed at 30,171.79 on 2026-09-28 while ours (and Sarmaaya's) is 35,012.45. Every candle has to
 *     be checked against the value we already trust before any of it is stored.
 *   - **The scanner answers with no per-symbol timestamp**, so this read cannot prove its own
 *     freshness. The caller's guard is what keeps a stale candle out; do not write these rows
 *     unguarded.
 */
export const CANDLE_COLUMNS = ['name', 'open', 'high', 'low', 'close', 'volume'] as const;

/** Column positions, fixed by the list above and pinned by a test. */
export const OPEN_COLUMN_INDEX = 1;
export const HIGH_COLUMN_INDEX = 2;
export const LOW_COLUMN_INDEX = 3;
export const CLOSE_COLUMN_INDEX = 4;
export const VOLUME_COLUMN_INDEX = 5;

/** One request per this many symbols: 250 keeps us well inside what the scanner accepts. */
const SCANNER_BATCH_SIZE = 250;

export interface TradingViewCandle {
  symbol: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

/**
 * A price cell as a number, or `null`.
 *
 * `typeof` first, deliberately: `Number(null)` is `0` and `Number('')` is `0`, so coercing before
 * checking turns an absent leg into a real-looking reading and stores a candle that never traded. A
 * non-positive price is no reading either.
 */
function priceCell(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

/** Volume is the one leg where a zero is a fact — a session with no trades — rather than a gap. */
function volumeCell(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

/**
 * Scanner rows -> candles.
 *
 * The ticker-set query answers as `{ s: 'PSX:KSE100', d: [name, open, high, low, close, volume] }`, so
 * the symbol comes from `s` (stripped of its exchange prefix) and each leg from a fixed column
 * position. A null, absent or non-numeric leg is a gap in that leg only — never a zero. The first row
 * for a symbol wins: two rows for one ticker is an anomaly in the response, and the earlier one is the
 * one the requested ticker maps to.
 */
export function parseTradingViewCandles(payload: unknown): TradingViewCandle[] {
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  const bySymbol = new Map<string, TradingViewCandle>();
  for (const row of rows) {
    const candidate = row as { s?: unknown; d?: unknown };
    const symbol = String(candidate.s ?? '').split(':').pop()?.trim().toUpperCase() ?? '';
    if (!symbol || bySymbol.has(symbol)) continue;
    const cells = Array.isArray(candidate.d) ? candidate.d : [];
    const candle: TradingViewCandle = {
      symbol,
      open: priceCell(cells[OPEN_COLUMN_INDEX]),
      high: priceCell(cells[HIGH_COLUMN_INDEX]),
      low: priceCell(cells[LOW_COLUMN_INDEX]),
      close: priceCell(cells[CLOSE_COLUMN_INDEX]),
      volume: volumeCell(cells[VOLUME_COLUMN_INDEX]),
    };
    // A row whose price legs are all absent says nothing about the symbol: the scanner carries the
    // ticker but has no candle for it, which is a gap rather than a reading.
    if (candle.open === null && candle.high === null && candle.low === null && candle.close === null) {
      continue;
    }
    bySymbol.set(symbol, candle);
  }
  return [...bySymbol.values()];
}

/**
 * Candles for `symbols`, in as few requests as the scanner allows.
 *
 * Empty on total failure — the caller then writes nothing, and every value it already holds stays as
 * it was. A symbol the scanner does not carry is simply absent from the result, which the caller
 * records as unmatched rather than as a zero. One session's candles, not a history: the request asks
 * for the live daily bar, so this is idempotent within a session and safe to run on a schedule.
 */
export async function fetchTradingViewCandles(symbols: string[]): Promise<TradingViewCandle[]> {
  const candles: TradingViewCandle[] = [];
  for (let i = 0; i < symbols.length; i += SCANNER_BATCH_SIZE) {
    const batch = symbols.slice(i, i + SCANNER_BATCH_SIZE);
    try {
      const res = await fetch(SCANNER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'PSX-Scraper/1.0' },
        body: JSON.stringify({
          symbols: { tickers: batch.map((s) => `PSX:${s}`), query: { types: [] } },
          columns: [...CANDLE_COLUMNS],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        logger.warn('candle.scanner_failed', { status: res.status, batch: batch.length });
        continue;
      }
      candles.push(...parseTradingViewCandles(await res.json()));
    } catch (err) {
      logger.warn('candle.scanner_failed', { error: (err as Error).message, batch: batch.length });
    }
  }
  logger.info('candle.scanner_ok', { requested: symbols.length, withCandle: candles.length });
  return candles;
}
