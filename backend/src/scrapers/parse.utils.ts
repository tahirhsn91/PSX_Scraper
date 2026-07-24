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
