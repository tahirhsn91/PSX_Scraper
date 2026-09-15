/** Convert scraped strings like "1,234.50", "Rs. 45.2", "-3.1%" to numbers. */
export function toNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  // Extract the first numeric token (handles "Rs. 1,234.50", "-3.1%", "45").
  const match = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** Parse a date string to ISO, or null. Accepts common dd-Mon-yyyy / yyyy-mm-dd forms. */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return null;
}

/**
 * Interpret the PSX company page's "52-WEEK RANGE" pair.
 *
 * The page publishes it twice — as `data-low`/`data-high` on the `.numRange` node and as the
 * displayed "441.70 — 685.00" text — and the caller passes whichever it managed to read
 * (see `extractPsxPageData`). This is the only place the pair is interpreted.
 *
 * The two endpoints are a range whichever order PSX prints them in, so they are sorted;
 * a half-read pair keeps `null` for the side that is missing rather than duplicating the
 * value across both, and nothing is inferred when both are absent.
 */
export function parseWeek52Range(
  lowRaw: string | null | undefined,
  highRaw: string | null | undefined,
): { low: number | null; high: number | null } {
  const a = toNumber(lowRaw);
  const b = toNumber(highRaw);

  if (a === null || b === null) {
    return { low: a, high: b };
  }
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}
