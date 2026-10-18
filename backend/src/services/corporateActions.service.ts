import { prisma } from '../database/prisma';

/**
 * Corporate-action adjustment.
 *
 * The stored history is **as traded**: a session's close is the price that printed that day, in the
 * share count that existed that day. Across a split or a bonus that makes a chart lie — a 2-for-1
 * split looks like a 50% crash — and it makes every return that spans the event wrong.
 *
 * Adjustment here is multiplicative and backwards-only: a price dated *before* an action's ex-date is
 * multiplied by `ratioFrom / ratioTo`, and prices on or after it are untouched. Chaining two actions
 * multiplies the factors. A 2-for-1 split (1:2) therefore halves every earlier price; a 1-for-10
 * bonus (10:11) multiplies them by 10/11.
 *
 * Only `confirmed` actions are applied. Anything else — a proposed split, a rumour the source
 * carried — is stored and shown, but never moves a price: an adjustment is a statement about what
 * happened, not about what might.
 */

export interface ActionLike {
  type: string;
  exDate: string | null;
  ratioFrom: number | null;
  ratioTo: number | null;
  status: string;
}

/** The price factor one action implies, or null when it does not change the share count. */
export function actionFactor(a: ActionLike): number | null {
  if (a.status !== 'confirmed') return null;
  if (a.type !== 'SPLIT' && a.type !== 'BONUS') return null;
  if (!a.ratioFrom || !a.ratioTo || a.ratioFrom <= 0 || a.ratioTo <= 0) return null;
  return a.ratioFrom / a.ratioTo;
}

/**
 * The cumulative factor to apply to a price dated `date`.
 *
 * Every confirmed split/bonus whose ex-date is *after* `date` still lies between that price and
 * today, so all of them apply. An action with no ex-date cannot be placed on the timeline and is
 * skipped rather than guessed at.
 */
export function factorAt(actions: ActionLike[], date: string): number {
  let factor = 1;
  for (const a of actions) {
    if (!a.exDate) continue;
    if (a.exDate <= date) continue;
    const f = actionFactor(a);
    if (f != null) factor *= f;
  }
  return factor;
}

export interface PriceLike {
  time: string;
  /** The stored candle leaves open/high/low null when the provider did not publish them. */
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
}

/** Adjusts a candle series; untouched when there is nothing to apply. */
export function adjustSeries<T extends PriceLike>(candles: T[], actions: ActionLike[]): T[] {
  const usable = actions.filter((a) => a.exDate && actionFactor(a) != null);
  if (usable.length === 0) return candles;
  return candles.map((c) => {
    const f = factorAt(usable, c.time);
    if (f === 1) return c;
    const scale = (v: number | null) => (v == null ? null : v * f);
    return { ...c, open: scale(c.open), high: scale(c.high), low: scale(c.low), close: c.close * f };
  });
}

/** The stored actions for a symbol, oldest first, as plain numbers for the adjuster. */
export async function actionsFor(stockId: string): Promise<ActionLike[]> {
  const rows = await prisma.corporateAction.findMany({
    where: { stockId },
    orderBy: [{ exDate: 'asc' }],
    select: { type: true, exDate: true, ratioFrom: true, ratioTo: true, status: true },
  });
  return rows.map((r) => ({
    type: r.type,
    exDate: r.exDate ? r.exDate.toISOString().slice(0, 10) : null,
    ratioFrom: r.ratioFrom != null ? Number(r.ratioFrom) : null,
    ratioTo: r.ratioTo != null ? Number(r.ratioTo) : null,
    status: r.status,
  }));
}

/** Actions for a symbol, by ticker — the path the chart uses. */
export async function actionsForSymbol(symbol: string): Promise<ActionLike[]> {
  const stock = await prisma.stock.findUnique({
    where: { symbol: symbol.toUpperCase() },
    select: { id: true },
  });
  return stock ? actionsFor(stock.id) : [];
}
