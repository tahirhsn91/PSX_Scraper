/**
 * Portfolio valuation: the arithmetic behind the `/portfolio` page.
 *
 * Pure functions over the positions a user recorded and the live quote the list endpoint already
 * serves for each symbol — no DOM, no storage, no React — so every figure can be checked against
 * hand-computed values without mounting a page. The positions themselves live in `holdings.ts`.
 *
 * A position is a quantity and an average buy price; everything else is derived:
 *
 *   cost         = avgBuyPrice × quantity
 *   value        = currentPrice × quantity
 *   P&L          = value − cost
 *   P&L %        = (currentPrice − avgBuyPrice) ÷ avgBuyPrice × 100
 *   day change   = value − value ÷ (1 + changePercent ÷ 100)
 *   allocation % = value ÷ (the priced book's value) × 100
 *
 * The day change is built from the list endpoint's own per-symbol `changePercent` — measured by the
 * exchange off that symbol's previous close — rather than from an index figure, so it keeps meaning
 * "what these positions did today".
 *
 * Nothing here is rounded: rounding is the renderer's job (`formatRupees`, `formatPercent`), so a
 * total is never computed out of rows that were already rounded.
 */

/** A position as recorded on this device: how many shares, and what they cost on average. */
export interface Holding {
  symbol: string;
  quantity: number;
  avgBuyPrice: number;
}

/** The live figures a row needs, as read off the list endpoint for that symbol. */
export interface Quote {
  symbol: string;
  companyName: string | null;
  currentPrice: number | null;
  changePercent: number | null;
}

/** A holding joined to its quote, with every derived figure. `null` means "not known", never zero. */
export interface HoldingRow {
  symbol: string;
  companyName: string | null;
  quantity: number;
  avgBuyPrice: number;
  currentPrice: number | null;
  changePercent: number | null;
  /** What the position cost — always known, because it needs no live price. */
  cost: number;
  /** What it is worth now; null while the symbol has no live price. */
  value: number | null;
  pl: number | null;
  plPercent: number | null;
  /** Rupees gained or lost today, from this symbol's own `changePercent`. */
  dayChange: number | null;
  /** This symbol's own day move, as published. */
  dayChangePercent: number | null;
  /** Share of the priced book; null for an unpriced position, which holds no slice of it. */
  allocationPercent: number | null;
}

/** The figures the summary row reports. */
export interface PortfolioTotals {
  /** Positions recorded, priced or not. */
  holdings: number;
  /** Positions with a live price — the only ones the rupee totals are drawn from. */
  priced: number;
  /** Everything paid for every position, priced or not. */
  invested: number;
  /** Value of the priced positions. */
  value: number;
  /** That value less what those priced positions cost. */
  pl: number;
  plPercent: number | null;
  /** Sum of the priced positions' own day moves; null when none of them reported one. */
  dayChange: number | null;
  dayChangePercent: number | null;
}

/** What a position cost. Independent of any live price, so it is never null. */
export const holdingCost = (holding: Holding): number => holding.avgBuyPrice * holding.quantity;

/**
 * Is this a position this page can price? A stored row is user data and may be anything — an older
 * shape, a hand-edited value — so it is checked before it is allowed to reach the arithmetic.
 * `Infinity` and `NaN` are rejected with `Number.isFinite`: they would otherwise spread silently
 * through every total on the page.
 */
export function isHolding(value: unknown): value is Holding {
  if (typeof value !== 'object' || value === null) return false;
  const h = value as Record<string, unknown>;
  return (
    typeof h.symbol === 'string' &&
    h.symbol.trim().length > 0 &&
    typeof h.quantity === 'number' &&
    Number.isFinite(h.quantity) &&
    h.quantity > 0 &&
    typeof h.avgBuyPrice === 'number' &&
    Number.isFinite(h.avgBuyPrice) &&
    h.avgBuyPrice >= 0
  );
}

/** Today's move in rupees, from a percentage the exchange measured off the previous close. */
function dayChangeOf(value: number, changePercent: number | null): number | null {
  if (changePercent == null || !Number.isFinite(changePercent)) return null;
  const previous = value / (1 + changePercent / 100);
  if (!Number.isFinite(previous)) return null;
  return value - previous;
}

/**
 * Join holdings to their quotes and price each one.
 *
 * `quotes` is keyed by upper-cased symbol. A holding with no quote — or one whose quote carries no
 * price — keeps the figures that need no price and reports null for the rest; it is never treated
 * as worth zero, which would read as a real loss.
 */
export function buildRows(holdings: Holding[], quotes: Map<string, Quote>): HoldingRow[] {
  const rows = holdings.map((holding): HoldingRow => {
    const quote = quotes.get(holding.symbol.toUpperCase());
    const cost = holdingCost(holding);
    const price = quote?.currentPrice ?? null;
    const value = price == null ? null : price * holding.quantity;
    return {
      symbol: holding.symbol,
      companyName: quote?.companyName ?? null,
      quantity: holding.quantity,
      avgBuyPrice: holding.avgBuyPrice,
      currentPrice: price,
      changePercent: quote?.changePercent ?? null,
      cost,
      value,
      pl: value == null ? null : value - cost,
      plPercent:
        value == null || holding.avgBuyPrice <= 0
          ? null
          : ((price as number) - holding.avgBuyPrice) / holding.avgBuyPrice * 100,
      dayChange: value == null ? null : dayChangeOf(value, quote?.changePercent ?? null),
      dayChangePercent: quote?.changePercent ?? null,
      allocationPercent: null,
    };
  });

  // Allocation is a share of the priced book only: an unpriced position must not be handed a slice
  // of a total it is not part of, and every share must add up to 100%.
  const pricedValue = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  if (pricedValue > 0) {
    for (const row of rows) {
      row.allocationPercent = row.value == null ? null : (row.value / pricedValue) * 100;
    }
  }
  return rows;
}

/**
 * Sum the book.
 *
 * `invested` counts every position — that is what the user actually paid. The value, P&L and P&L %
 * are drawn from the priced positions alone, so a symbol with no live price cannot distort them.
 */
export function summarise(rows: HoldingRow[]): PortfolioTotals {
  const priced = rows.filter((row) => row.value != null);
  const invested = rows.reduce((sum, row) => sum + row.cost, 0);
  const pricedCost = priced.reduce((sum, row) => sum + row.cost, 0);
  const value = priced.reduce((sum, row) => sum + (row.value as number), 0);
  const pl = value - pricedCost;

  const reported = priced.filter((row) => row.dayChange != null);
  const dayChange = reported.length
    ? reported.reduce((sum, row) => sum + (row.dayChange as number), 0)
    : null;
  // Yesterday's value of the same positions, so the percentage is measured against the base today's
  // move is actually a move from — not against the post-move value.
  const previousValue = dayChange == null ? null : value - dayChange;

  return {
    holdings: rows.length,
    priced: priced.length,
    invested,
    value,
    pl,
    plPercent: pricedCost > 0 ? (pl / pricedCost) * 100 : null,
    dayChange,
    dayChangePercent:
      dayChange != null && previousValue != null && previousValue > 0
        ? (dayChange / previousValue) * 100
        : null,
  };
}
