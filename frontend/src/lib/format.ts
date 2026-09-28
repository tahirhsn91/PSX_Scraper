/**
 * Market cap as a table cell can hold it: `Rs 745.2B`, `Rs 1.4T`.
 *
 * PSX market caps run to twelve digits, which is unreadable in a column that also carries prices
 * and volumes — so the cell abbreviates and the exact figure stays available in its title.
 *
 * Null is not zero: when no source published a figure this returns null and the caller renders
 * the dash, exactly like every other unread value in the table.
 */
export function formatMarketCap(rupees: number | null | undefined): string | null {
  if (rupees == null || !Number.isFinite(rupees) || rupees <= 0) return null;
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (rupees >= size) {
      const scaled = rupees / size;
      // One decimal below 100 (745.2B), none above (1,378B would read as 1,378B either way).
      return `Rs ${scaled.toFixed(scaled >= 100 ? 0 : 1)}${suffix}`;
    }
  }
  return `Rs ${rupees.toFixed(0)}`;
}

/** The same figure unabbreviated, for a cell's tooltip. */
export function formatRupees(rupees: number): string {
  return `Rs ${rupees.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * The dash every unread value renders as. "No data is not zero" — a missing reading must never be
 * printed as `0` or left blank, because both read as a real figure.
 */
export const DASH = '—';

/** Direction glyphs. Direction is always carried by the glyph as well as the colour. */
export const GLYPH = { up: '▲', down: '▼', flat: '·' } as const;

export type Trend = 'up' | 'down' | 'flat';

/** Anything inside ±0.05% is flat, matching the chart code's own band (`candles.ts`). */
export const TREND_BAND = 0.0005;

export function trendOf(value: number | null | undefined): Trend | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.abs(value) < TREND_BAND) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/** Plain number with grouping: prices, levels, volumes. Null-safe (returns the dash). */
export function formatNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 },
): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value.toLocaleString(undefined, options);
}

/** Whole-number counts (share volume, job counts). Null-safe. */
export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** A percentage change with its sign: `+1.07%`, `-0.23%`, `0.00%`. Null-safe. */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/** A signed number with its sign, for deltas that are not percentages. Null-safe. */
export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Absolute date + time, one format for the whole app: `28 Sep 2026, 09:17`. Null-safe. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value == null) return DASH;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Time only, for a "last synced" cell where the date is implied: `09:17`. Null-safe. */
export function formatTime(value: string | number | Date | null | undefined): string {
  if (value == null) return DASH;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Date only, where a time would be noise (a trade date): `28 Sep 2026`. Null-safe. */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value == null) return DASH;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Relative time for recent events (`just now`, `3m ago`, `2h ago`, `4d ago`), falling back to the
 * absolute date once it stops being useful. The absolute value stays available in a tooltip.
 */
export function formatRelative(value: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (value == null) return DASH;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return DASH;
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 0) return formatDateTime(d);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return formatDateTime(d);
}

/**
 * A share count as a card line can hold it: `40.7M`, and un-abbreviated below a million.
 *
 * An index card shows one volume rather than a column of them, so this abbreviates only when the
 * number would be genuinely long. Null is not zero: a missing reading returns null and the caller
 * renders the dash, exactly like every other unread value.
 */
export function formatVolume(shares: number | null | undefined): string | null {
  if (shares == null || !Number.isFinite(shares) || shares <= 0) return null;
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
  ];
  for (const [size, suffix] of units) {
    if (shares >= size) {
      const scaled = shares / size;
      return `${scaled.toFixed(scaled >= 100 ? 0 : 1)}${suffix}`;
    }
  }
  return shares.toLocaleString();
}

/**
 * A job duration for a table cell: `0.8s`, `12.4s`, `3m 05s`. Null-safe, and never invents a
 * duration for a job that has not finished — the caller renders the dash instead.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return DASH;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}
