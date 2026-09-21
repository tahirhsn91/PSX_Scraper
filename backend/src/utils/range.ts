/**
 * Historical range presets shared across API + jobs.
 *
 * `2Y` is still accepted but no longer offered in the dashboard's button row: dropping a value
 * from here would turn an existing client's request into a 400, and accepting more than the UI
 * shows costs nothing.
 */
export const HISTORY_RANGES = ['1W', '1M', '6M', '1Y', '2Y', '3Y', '5Y', 'MAX'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** Cutoff "from" date for a range, or undefined for MAX (no lower bound). */
export function rangeToFrom(range: HistoryRange, now = new Date()): Date | undefined {
  const d = new Date(now);
  switch (range) {
    case '1W': d.setDate(d.getDate() - 7); return d;
    case '1M': d.setMonth(d.getMonth() - 1); return d;
    case '6M': d.setMonth(d.getMonth() - 6); return d;
    case '1Y': d.setFullYear(d.getFullYear() - 1); return d;
    case '2Y': d.setFullYear(d.getFullYear() - 2); return d;
    case '3Y': d.setFullYear(d.getFullYear() - 3); return d;
    case '5Y': d.setFullYear(d.getFullYear() - 5); return d;
    case 'MAX': return undefined;
  }
}

export const rangeLabel: Record<HistoryRange, string> = {
  '1W': 'Past 1 week',
  '1M': 'Past 1 month',
  '6M': 'Past 6 months',
  '1Y': 'Past 1 year',
  '2Y': 'Past 2 years',
  '3Y': 'Past 3 years',
  '5Y': 'Past 5 years',
  MAX: 'Max',
};
