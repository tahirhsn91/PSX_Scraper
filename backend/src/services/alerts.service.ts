/**
 * Alert evaluation.
 *
 * Everything here is a statement about data, never advice. The copy says what happened
 * ("closed at 299.10, above your 295.00 level") and never what to do about it — no "buy", no "sell",
 * no "opportunity". An alert is a condition the reader chose to be told about.
 *
 * Cooldown is per alert: once fired, it stays quiet for `cooldownMinutes`. A price resting on the
 * line would otherwise fire on every poll, which trains the reader to ignore the alerts entirely.
 */

export const ALERT_KINDS = [
  'PRICE_ABOVE',
  'PRICE_BELOW',
  'PCT_MOVE',
  'RSI_ABOVE',
  'RSI_BELOW',
  'CROSS_ABOVE_SMA',
  'CROSS_BELOW_SMA',
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertLike {
  id: string;
  kind: string;
  threshold: number | null;
  paused: boolean;
  lastFiredAt: Date | null;
  cooldownMinutes: number;
}

export interface MarketContext {
  symbol: string;
  price: number | null;
  prevClose: number | null;
  rsi: number | null;
  sma50: number | null;
  prevSma50: number | null;
  sma200: number | null;
  prevSma200: number | null;
}

export interface FiredEvent {
  alertId: string;
  value: number;
  message: string;
}

/** Human wording for the condition, used in the UI so the rule is never shown as a code. */
export function describeAlert(kind: string, threshold: number | null): string {
  const t = threshold != null ? threshold.toFixed(2) : '—';
  switch (kind) {
    case 'PRICE_ABOVE':
      return `Price at or above ${t}`;
    case 'PRICE_BELOW':
      return `Price at or below ${t}`;
    case 'PCT_MOVE':
      return `Daily move at least ${t}% in either direction`;
    case 'RSI_ABOVE':
      return `RSI(14) at or above ${t}`;
    case 'RSI_BELOW':
      return `RSI(14) at or below ${t}`;
    case 'CROSS_ABOVE_SMA':
      return 'Price crossed above its 50-session average';
    case 'CROSS_BELOW_SMA':
      return 'Price crossed below its 50-session average';
    default:
      return kind;
  }
}

/** The reading an alert is judged against, so the event says what was measured. */
function readingFor(kind: string, ctx: MarketContext): number | null {
  switch (kind) {
    case 'RSI_ABOVE':
    case 'RSI_BELOW':
      return ctx.rsi;
    case 'CROSS_ABOVE_SMA':
    case 'CROSS_BELOW_SMA':
      return ctx.sma50;
    default:
      return ctx.price;
  }
}

/** True when the condition holds right now (crosses compare against the previous session). */
export function isTriggered(kind: string, threshold: number | null, ctx: MarketContext): boolean {
  const { price, prevClose, rsi, sma50, prevSma50 } = ctx;
  switch (kind) {
    case 'PRICE_ABOVE':
      return price != null && threshold != null && price >= threshold;
    case 'PRICE_BELOW':
      return price != null && threshold != null && price <= threshold;
    case 'PCT_MOVE':
      return (
        price != null && prevClose != null && prevClose > 0 && threshold != null &&
        Math.abs(((price - prevClose) / prevClose) * 100) >= threshold
      );
    case 'RSI_ABOVE':
      return rsi != null && threshold != null && rsi >= threshold;
    case 'RSI_BELOW':
      return rsi != null && threshold != null && rsi <= threshold;
    // A cross needs the *previous close* against the previous average and today's close against
    // today's average — comparing the average to itself would fire every time the average ticked up.
    case 'CROSS_ABOVE_SMA':
      return (
        price != null && prevClose != null && sma50 != null && prevSma50 != null &&
        prevClose < prevSma50 && price >= sma50
      );
    case 'CROSS_BELOW_SMA':
      return (
        price != null && prevClose != null && sma50 != null && prevSma50 != null &&
        prevClose >= prevSma50 && price < sma50
      );
    default:
      // An unknown kind never fires. It is still stored, so the reader can see and delete it.
      return false;
  }
}

/** True when the alert is allowed to fire at `now`. */
export function isCool(alert: AlertLike, now: Date): boolean {
  if (alert.paused) return false;
  if (!alert.lastFiredAt) return true;
  const elapsedMs = now.getTime() - alert.lastFiredAt.getTime();
  return elapsedMs >= alert.cooldownMinutes * 60_000;
}

function messageFor(kind: string, threshold: number | null, ctx: MarketContext, value: number): string {
  const s = ctx.symbol;
  const fmt = (n: number) => n.toFixed(2);
  switch (kind) {
    case 'PRICE_ABOVE':
      return `${s} is at ${fmt(value)}, at or above your ${fmt(threshold ?? 0)} level.`;
    case 'PRICE_BELOW':
      return `${s} is at ${fmt(value)}, at or below your ${fmt(threshold ?? 0)} level.`;
    case 'PCT_MOVE':
      return `${s} moved ${fmt(value)}% today, at least the ${fmt(threshold ?? 0)}% you set.`;
    case 'RSI_ABOVE':
      return `${s} RSI(14) is ${fmt(value)}, at or above ${fmt(threshold ?? 0)}.`;
    case 'RSI_BELOW':
      return `${s} RSI(14) is ${fmt(value)}, at or below ${fmt(threshold ?? 0)}.`;
    case 'CROSS_ABOVE_SMA':
      return `${s} closed at ${fmt(ctx.price ?? 0)}, above its 50-session average of ${fmt(value)} for the first time since the previous session.`;
    case 'CROSS_BELOW_SMA':
      return `${s} closed at ${fmt(ctx.price ?? 0)}, below its 50-session average of ${fmt(value)} for the first time since the previous session.`;
    default:
      return `${s}: condition met.`;
  }
}

/**
 * Evaluates one alert. Returns the event to store, or null when it is not triggered, is paused, or
 * is still inside its cooldown.
 */
export function evaluateAlert(alert: AlertLike, ctx: MarketContext, now: Date): FiredEvent | null {
  if (!isCool(alert, now)) return null;
  if (!isTriggered(alert.kind, alert.threshold, ctx)) return null;

  const reading = readingFor(alert.kind, ctx);
  if (reading == null) return null;

  // A percentage-move alert reports the move itself, not the price.
  const value =
    alert.kind === 'PCT_MOVE' && ctx.price != null && ctx.prevClose != null && ctx.prevClose > 0
      ? ((ctx.price - ctx.prevClose) / ctx.prevClose) * 100
      : reading;

  return { alertId: alert.id, value, message: messageFor(alert.kind, alert.threshold, ctx, value) };
}

/** Every alert that should fire, given the current market snapshot. */
export function evaluateAll(
  alerts: AlertLike[],
  contextFor: (alertId: string) => MarketContext | null,
  now: Date,
): FiredEvent[] {
  const fired: FiredEvent[] = [];
  for (const a of alerts) {
    const ctx = contextFor(a.id);
    if (!ctx) continue;
    const ev = evaluateAlert(a, ctx, now);
    if (ev) fired.push(ev);
  }
  return fired;
}
