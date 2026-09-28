import { childLogger, logger } from '../utils/logger';
import { fetchTradingViewCandles, type TradingViewCandle } from '../scrapers/tradingViewCandles.scraper';
import { indexRepository } from '../repositories/index.repository';
import { listTrackedWithSessionRow, setSessionCandle } from '../repositories/stockPrice.repository';

/**
 * The session's daily candle, written onto the row that session already owns.
 *
 * Why this exists: an index's `open` has no reachable publisher. The exchange's market-summary
 * carousel carries level, change and percent only, `dps.psx.com.pk` is refused at the edge, and
 * Sarmaaya's `indices/overview` publishes `close`/`prevClose`/`high`/`low`/`volume` and no open — so
 * the open we stored was our own first observation inside a six-minute window (`openingLevelFor`), a
 * number *near* the session's first trade rather than it. On 2026-09-28 KSE-100's stored open was
 * 170,944.02 where the session really opened at 170,991.1346.
 *
 * TradingView's scanner answers with the live daily bar for the whole exchange in a handful of POSTs.
 * It covers 11 of our 18 indices (HBLTTI, JSGBKTI, JSMFI, KSE100PR, MII30, NBPPGI and NITPGI are not
 * in its Pakistan universe) and 485 of our 508 stocks (the rest are ETFs and preference shares it does
 * not carry). Its closes agree with ours to the paisa on every symbol sampled, which is why its open
 * can be trusted where it answers.
 *
 * **The guard is the point.** A ticker is not a contract: TradingView's `PSX:OGTI` closed at 30,171.79
 * on 2026-09-28 where the exchange's OGTI — and ours — closed at 35,012.45, a different instrument
 * under the same name. So a candle is written only when its close agrees with the value we already
 * hold from PSX or Sarmaaya, within `CANDLE_MAX_DEVIATION`. No reference is no proof, and no proof
 * means no write: a wrong value is worse than a dash.
 *
 * The writes are narrow and idempotent — `open` (and `close` for stocks) on the session's existing
 * row, never a new row, never `value`, never `currentPrice` — so the sync is safe to run every few
 * minutes and safe to run again after the close, which is what leaves the row holding the session's
 * real open and close.
 */

/** How far a candle's close may sit from the value we trust before the whole candle is refused. */
export const CANDLE_MAX_DEVIATION = 0.005;

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
/** The first trade of a session, in minutes past PKT midnight — `OPEN_CAPTURE_OPEN_MINUTES`. */
const SESSION_OPEN_MINUTES = 9 * 60 + 30;

/**
 * The session a candle read *now* belongs to, as the marker every writer keys its row on.
 *
 * `sessionStamp` maps an instant to the PKT calendar date it falls on. That is right for a reading
 * that carries the exchange's own session timestamp — the quote path passes one, and a pre-open quote
 * then correctly maps to the session it belongs to — but wrong for this read, which carries no
 * timestamp at all. Measured on 2026-09-28 at 00:38 PKT the scanner was still answering with the
 * candle that closed at 15:35 that afternoon, while `sessionStamp(now)` stamped it **the next day's**
 * session: the sync then found no row for that session and wrote nothing, eleven indices and 508
 * stocks reported as `noRow`.
 *
 * So the rule here is the candle's own: before the open it is the previous trading day's, from the
 * open onwards it is today's. Weekend days step back to Friday. A market holiday cannot be known here
 * — that needs the published calendar — but a wrong stamp is safe by construction: the session it
 * names has no row, so nothing is written and the run reports it as `noRow` rather than writing a
 * candle onto the wrong session.
 */
export function candleSessionStamp(now: Date): Date {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const minutesPastMidnight = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
  // The PKT calendar date, held as UTC midnight — the same convention `sessionStamp` uses.
  const day = new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()));
  if (minutesPastMidnight < SESSION_OPEN_MINUTES) day.setUTCDate(day.getUTCDate() - 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1);
  // 16:00 PKT of that date is the marker every writer keys on: the PKT date held as UTC midnight,
  // plus eleven hours (UTC+5 means 11:00Z is 16:00 PKT) — the same arithmetic `sessionStamp` uses.
  return new Date(day.getTime() + 11 * 60 * 60 * 1000);
}

/**
 * Whether a candle's close may be believed, given the value we already hold for the symbol.
 *
 * Half a percent is the tolerance: every symbol sampled agrees far inside it (KSE-100 0.0001%), while
 * the one instrument we know the scanner names differently is out by ~14%. A missing reference is a
 * refusal, not a pass — that is the case where nothing can catch a wrong number.
 */
export function candleIsPlausible(close: number | null, reference: number | null): boolean {
  if (close === null || reference === null) return false;
  if (!Number.isFinite(close) || !Number.isFinite(reference) || reference <= 0) return false;
  return Math.abs(close - reference) / reference <= CANDLE_MAX_DEVIATION;
}

export interface CandleTally {
  /** Candles written onto the session's row. */
  written: number;
  /** The scanner carries no candle for this symbol — its existing value is left alone. */
  unmatched: number;
  /** The session has no row for this symbol yet, so there is nothing to write onto. */
  noRow: number;
  /** A candle arrived but its close could not be reconciled with the value we hold. */
  refused: number;
}

export interface SessionCandleSummary {
  session: string;
  requested: number;
  indices: CandleTally;
  stocks: CandleTally;
  /** The symbols refused, named — a refusal is a finding, not a number to add up. */
  refusedSymbols: string[];
}

const emptyTally = (): CandleTally => ({ written: 0, unmatched: 0, noRow: 0, refused: 0 });

/**
 * Read the session's candles once and write what can be reconciled, for every tracked index and stock.
 *
 * Every tally above is reported rather than folded into a success count: "485 written" and "485
 * written, 23 unmatched, 1 refused" are different facts about a session, and only the second one says
 * whether the universe was covered.
 */
export async function syncSessionCandles(): Promise<SessionCandleSummary> {
  const log = childLogger({ op: 'session-candle' });
  const tradeDate = candleSessionStamp(new Date());

  const indices = await indexRepository.findAll();
  const stocks = await listTrackedWithSessionRow(tradeDate);

  const symbols = [...indices.map((i) => i.symbol), ...stocks.rows.map((s) => s.symbol)];
  const candles = await fetchTradingViewCandles(symbols);
  const bySymbol = new Map<string, TradingViewCandle>(candles.map((c) => [c.symbol, c]));

  const indexTally = emptyTally();
  const stockTally = emptyTally();
  // A tracked symbol with no row for this session, or a row the quote poll has not priced yet, is the
  // same situation here: nothing to attach a candle to and nothing to check one against.
  stockTally.noRow = stocks.tracked - stocks.rows.length;
  const refusedSymbols: string[] = [];
  for (const index of indices) {
    const candle = bySymbol.get(index.symbol);
    if (!candle) {
      indexTally.unmatched += 1;
      continue;
    }
    const row = index.values[0];
    if (!row || row.tradeDate.getTime() !== tradeDate.getTime()) {
      indexTally.noRow += 1;
      continue;
    }
    const reference = Number(row.value);
    if (!candleIsPlausible(candle.close, reference)) {
      indexTally.refused += 1;
      refusedSymbols.push(index.symbol);
      log.warn('session-candle.refused', {
        symbol: index.symbol,
        candleClose: candle.close,
        reference,
      });
      continue;
    }
    if (candle.open === null) {
      indexTally.unmatched += 1;
      continue;
    }
    indexTally.written += (await indexRepository.setSessionOpen(index.id, tradeDate, candle.open)) ? 1 : 0;
  }

  for (const stock of stocks.rows) {
    const candle = bySymbol.get(stock.symbol);
    if (!candle) {
      stockTally.unmatched += 1;
      continue;
    }
    if (stock.currentPrice === null) {
      stockTally.noRow += 1;
      continue;
    }
    if (!candleIsPlausible(candle.close, stock.currentPrice)) {
      stockTally.refused += 1;
      refusedSymbols.push(stock.symbol);
      log.warn('session-candle.refused', {
        symbol: stock.symbol,
        candleClose: candle.close,
        reference: stock.currentPrice,
      });
      continue;
    }
    if (candle.open === null && candle.close === null) {
      stockTally.unmatched += 1;
      continue;
    }
    stockTally.written += (await setSessionCandle(stock.id, tradeDate, { open: candle.open, close: candle.close })) ? 1 : 0;
  }

  const summary: SessionCandleSummary = {
    session: tradeDate.toISOString(),
    requested: symbols.length,
    indices: indexTally,
    stocks: stockTally,
    refusedSymbols,
  };
  logger.info('session-candle.done', summary);
  return summary;
}
