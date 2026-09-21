/**
 * Pure mapping for the index read model (no database import, so it is unit-testable
 * on its own — see tests/index-summary.test.ts).
 *
 * An index has no company page, ratios or dividends: the only upstream is PSX's
 * time-series endpoint, which gives one close (plus open and volume) per trading day
 * and, separately, an intraday series. The summary therefore reports:
 *
 *   value          newest reading — the newest intraday point when a session is open,
 *                  otherwise the latest daily close
 *   previousClose  the last daily close *strictly before* the day of `value`
 *   change / pct   value - previousClose
 *   open / volume  from the daily row for the day of `value`, when one exists
 *   high / low     null: the upstream series carries no high/low for indices
 */

/** Minimal row shape (structurally satisfied by a Prisma IndexValue row). */
export interface IndexValueRow {
  tradeDate: Date;
  value: number | { toString(): string };
  open: number | { toString(): string } | null;
  volume: bigint | null;
}

export interface LiveReading {
  value: number;
  at: Date;
  /** The exchange's published change figures, when it reported them. */
  change?: number | null;
  changePercent?: number | null;
}

export interface IndexSummaryInput {
  symbol: string;
  name: string;
  /** Daily rows, newest first. */
  daily: IndexValueRow[];
  live?: LiveReading | null;
}

export interface IndexHistoryItem {
  lastTradeDate: Date;
  currentPrice: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

const toNum = (v: number | { toString(): string } | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

const round = (v: number, dp = 4): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** UTC calendar day, so two timestamps on the same trading day compare equal. */
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export function buildIndexSummary(input: IndexSummaryInput) {
  const { symbol, name, daily } = input;
  const latest = daily[0] ?? null;
  const live = input.live ?? null;

  // Prefer the intraday reading only when it is genuinely newer than the last close.
  const useLive = !!live && (!latest || live.at.getTime() > latest.tradeDate.getTime());
  const value = useLive ? live!.value : toNum(latest?.value);
  const lastTradeDate = useLive ? live!.at : latest?.tradeDate ?? null;

  // Previous close: newest daily row before the day of `value`. Comparing days (not
  // timestamps) is what makes this work mid-session, when the day's own row may exist.
  const previousClose = lastTradeDate
    ? toNum(daily.find((r) => dayKey(r.tradeDate) < dayKey(lastTradeDate!))?.value)
    : null;

  // Prefer the exchange's published move: it is measured against the official previous close.
  // Derive one only when the page did not report a figure — which is the case for a series we
  // are still accumulating ourselves. `null` (unknown) is never rendered as zero.
  const derivedChange = value !== null && previousClose !== null ? round(value - previousClose) : null;
  const change = (useLive ? live!.change ?? null : null) ?? derivedChange;
  const changePercent =
    (useLive ? live!.changePercent ?? null : null) ??
    (derivedChange !== null && previousClose ? round((derivedChange / previousClose) * 100) : null);

  const sameDay = lastTradeDate ? daily.find((r) => dayKey(r.tradeDate) === dayKey(lastTradeDate!)) ?? null : null;

  return {
    symbol,
    name,
    value: value === null ? null : round(value),
    change,
    changePercent,
    open: toNum(sameDay?.open) ?? toNum(latest?.open),
    // Not provided by the DPS index series (only close/open/volume per day).
    high: null,
    low: null,
    previousClose,
    volume: sameDay?.volume != null ? Number(sameDay.volume) : latest?.volume != null ? Number(latest.volume) : null,
    lastTradeDate,
  };
}

/** Normalise a stored live reading (nullable Decimal + Date) into a LiveReading. */
export function liveReading(
  value: number | { toString(): string } | null,
  at: Date | null,
  change: number | { toString(): string } | null = null,
  changePercent: number | { toString(): string } | null = null,
): LiveReading | null {
  if (value === null || at === null) return null;
  const reading: LiveReading = { value: Number(value), at };
  // Carried only when the exchange actually published them, so a reading that predates this
  // field keeps exactly the shape it had before.
  if (change !== null && change !== undefined) reading.change = Number(change);
  if (changePercent !== null && changePercent !== undefined) reading.changePercent = Number(changePercent);
  return reading;
}

/** A daily row in the same shape the stock history endpoint returns. */
export function toHistoryItem(row: IndexValueRow): IndexHistoryItem {
  const close = Number(row.value);
  return {
    lastTradeDate: row.tradeDate,
    currentPrice: close,
    open: toNum(row.open),
    high: null,
    low: null,
    close,
    volume: row.volume === null ? null : Number(row.volume),
  };
}
