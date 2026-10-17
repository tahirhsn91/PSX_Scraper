import type { StockFilters, StockListItem, StockSortField, SortOrder } from '../repositories/stock.repository';

/**
 * Named screens, defined once on the server.
 *
 * The point is not convenience — it is that "biggest gainers" should mean the same thing whether it
 * is asked for by the web app, a saved link or a future client. So the criteria, the ordering and
 * the wording of the reason all live here, and `/stocks?preset=…` applies them server-side.
 *
 * Two rules the definitions keep deliberately conservative:
 *
 * - **P/E screens only include companies with positive earnings.** A loss-making company has no
 *   meaningful P/E; the ratio is negative or absent, and sorting it to the top of a "low P/E" list
 *   would present a loss as a bargain. That is the single most common way a screener lies.
 * - **Nothing is called "undervalued", "cheap" or "best".** A low multiple is a fact about the
 *   price relative to reported earnings, not a judgement, and the label says only what it is.
 */

export type PresetKey =
  | 'gainers'
  | 'losers'
  | 'most_active'
  | 'highest_yield'
  | 'low_pe'
  | 'high_pe';

export interface ScreenerPreset {
  key: PresetKey;
  label: string;
  /** One sentence: what the screen keeps, and over what period. */
  description: string;
  /** A limitation worth printing next to the results, when there is one. */
  caveat?: string;
  filters: StockFilters;
  sort: StockSortField;
  order: SortOrder;
  /** Why this particular row is on the list — computed per row, server-side. */
  reason: (row: StockListItem, rank: number, total: number) => string;
}

const pct = (v: number | null | undefined): string =>
  v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

const shares = (v: number | null | undefined): string =>
  v == null ? '' : `${v.toLocaleString('en-PK')} shares`;

export const SCREENER_PRESETS: Record<PresetKey, ScreenerPreset> = {
  gainers: {
    key: 'gainers',
    label: 'Gainers',
    description: 'Stocks that rose in the last session, biggest gain first.',
    filters: { minChangePercent: 1 },
    sort: 'changePercent',
    order: 'desc',
    reason: (row, rank, total) =>
      `${pct(row.changePercent)} today · #${rank} of ${total}`,
  },
  losers: {
    key: 'losers',
    label: 'Losers',
    description: 'Stocks that fell in the last session, biggest fall first.',
    filters: { maxChangePercent: -1 },
    sort: 'changePercent',
    order: 'asc',
    reason: (row, rank, total) =>
      `${pct(row.changePercent)} today · #${rank} of ${total}`,
  },
  most_active: {
    key: 'most_active',
    label: 'Most active',
    description: 'Stocks ranked by shares traded in the last session.',
    filters: {},
    sort: 'volume',
    order: 'desc',
    reason: (row, rank) => `${shares(row.volume)} traded · #${rank} by volume`,
  },
  highest_yield: {
    key: 'highest_yield',
    label: 'Highest yield',
    description: 'Stocks ranked by dividend yield, using the latest published figure.',
    caveat: 'Yield is the last declared dividend against today’s price; it is not a forecast.',
    filters: { minDividendYield: 1 },
    sort: 'dividendYield',
    order: 'desc',
    reason: (row, rank) => `${row.dividendYield?.toFixed(2) ?? '—'}% yield · #${rank} by yield`,
  },
  low_pe: {
    key: 'low_pe',
    label: 'Low P/E',
    description: 'Profitable companies ranked by price-to-earnings, lowest first, P/E from 1 to 10.',
    caveat:
      'Only companies with positive earnings are included, and P/E below 1 is excluded — earnings above market value is almost always a stale or mis-scaled figure, not a bargain.',
    filters: { minPe: 1, maxPe: 10 },
    sort: 'peRatio',
    order: 'asc',
    reason: (row, rank, total) => `P/E ${row.peRatio?.toFixed(1) ?? '—'} · #${rank} of ${total}`,
  },
  high_pe: {
    key: 'high_pe',
    label: 'High P/E',
    description: 'Profitable companies ranked by price-to-earnings, highest first, P/E above 10.',
    caveat: 'Only companies with positive earnings are included — a loss-maker has no meaningful P/E.',
    filters: { minPe: 10 },
    sort: 'peRatio',
    order: 'desc',
    reason: (row, rank, total) => `P/E ${row.peRatio?.toFixed(1) ?? '—'} · #${rank} of ${total}`,
  },
};

export const PRESET_KEYS = Object.keys(SCREENER_PRESETS) as PresetKey[];

export const isPresetKey = (v: string): v is PresetKey => v in SCREENER_PRESETS;

/** The list the screener renders as chips: no functions, just what the UI needs. */
export const presetSummaries = () =>
  PRESET_KEYS.map((key) => {
    const p = SCREENER_PRESETS[key];
    return { key: p.key, label: p.label, description: p.description, caveat: p.caveat }; 
  });
