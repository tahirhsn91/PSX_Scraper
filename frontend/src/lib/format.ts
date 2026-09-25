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
