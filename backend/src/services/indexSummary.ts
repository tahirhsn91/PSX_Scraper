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
  /**
   * Sum of the constituents' volumes for the newest session — set only when that sum is provably
   * PSX's own figure (see `derivedIndexVolume`). Distinct from `volume`, which is what the exchange
   * published and has been unavailable since 2026-09-22.
   */
  constituentVolume?: number | null;
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

/** One daily candle for an index — structurally the same shape the stock candle endpoint returns. */
export interface IndexCandle {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

/**
 * Index value rows as candles, oldest session first.
 *
 * `value` is the close and `open` is carried when the row has one (the historical DPS series
 * did). High and low are always null: no index series we hold reports them, and the chart draws
 * a body-only candle rather than inventing a wick. Sessions are deduped with the newest reading
 * for a day winning, and a row with no value yields no candle at all — a bar with no price would
 * be fabricated.
 */
export function toIndexCandles(rows: IndexValueRow[]): IndexCandle[] {
  const byDay = new Map<string, IndexCandle>();
  // rows arrive newest first from the read path, so the first reading of a day is the newest.
  for (const row of rows) {
    const close = toNum(row.value);
    if (close === null || !row.tradeDate) continue;
    // The exchange's calendar day (UTC+5, no DST), matching how stock sessions are keyed.
    const time = new Date(row.tradeDate.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
    if (byDay.has(time)) continue;
    byDay.set(time, {
      time,
      open: toNum(row.open),
      high: null,
      low: null,
      close,
      volume: row.volume === null ? null : Number(row.volume),
    });
  }
  return [...byDay.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * The volume to show for an index, and only when it is provably the exchange's own figure.
 *
 * Index volume stopped being published to us on 2026-09-22 (DPS refuses every data path; the
 * market-summary carousel carries no volume). An index's traded volume is the sum of its
 * constituents' volumes, so a derived figure is available — but a *sum* is only the exchange's
 * number when the membership is complete and every member reported, and neither is guaranteed:
 * on 22 Sep the sum matched PSX exactly for 12 of the 17 indices and fell short for five
 * (KSE100 94,179,871 against a published 123,439,837, because three members had no volume that
 * day). So this returns the derived sum only when it equals the published figure on the check day,
 * and null otherwise — a card shows `—` rather than a number that quietly means something else.
 */
export function derivedIndexVolume(
  membersVolume: bigint | number | null | undefined,
  published: bigint | number | null | undefined,
  derivedCheck: bigint | number | null | undefined,
): number | null {
  if (membersVolume === null || membersVolume === undefined) return null;
  if (published === null || published === undefined) return null;
  if (derivedCheck === null || derivedCheck === undefined) return null;
  // Exact by construction, not approximately: both figures count the same members on the same day.
  if (Number(derivedCheck) !== Number(published)) return null;
  return Number(membersVolume);
}

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
    // Published by the exchange, and none has been available since 2026-09-22 (DPS refused; the
    // carousel carries no volume). Never derived from the constituents here — that figure is served
    // separately as `constituentVolume`, so this key keeps one meaning.
    volume: sameDay?.volume != null ? Number(sameDay.volume) : latest?.volume != null ? Number(latest.volume) : null,
    constituentVolume: input.constituentVolume ?? null,
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
