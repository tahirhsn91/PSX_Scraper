/** Convert scraped strings like "1,234.50", "Rs. 45.2", "-3.1%" to numbers. */
export function toNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  // Extract the first numeric token (handles "Rs. 1,234.50", "-3.1%", "45").
  const match = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Market cap in rupees, read from a source that publishes it in thousands.
 *
 * PSX labels the figure `Market Cap (000's)`, so the raw read is 1000x small; Sarmaaya's page
 * shows rupees. Normalising at the mapping site keeps one meaning in the database whatever the
 * source's label says. A zero, a negative or a missing read is `null` rather than a number: an
 * absent value must not become a real-looking one, and a placeholder zero must not become a cap.
 */
export function toMarketCapRupees(raw: string | null | undefined): number | null {
  const n = toNumber(raw);
  if (n === null || n <= 0) return null;
  return n * 1000;
}

/** Parse a date string to ISO, or null. Accepts common dd-Mon-yyyy / yyyy-mm-dd forms. */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return null;
}

/**
 * The session a quote belongs to, as a row key.
 *
 * Returns the reading's own trading day stamped at 16:00 PKT (11:00 UTC) — the same marker DPS
 * puts on its daily series and that the historical backfill stores. Every writer then converges
 * on ONE row per symbol per session, which is what makes the freshest volume visible: before
 * this, a page sync stamped its row with the moment it was read, so each sync appended a row
 * (FFC had six inside one session), the quote poll updated a *different* row, and the API served
 * whichever row carried the newest timestamp — a nine-minute-old reading could shadow a fresh one.
 *
 * The input is the *exchange's* quote timestamp, not our fetch time, so a reading taken before
 * the open (or over a weekend) carries the previous session's timestamp and correctly maps to
 * that session rather than to today.
 */
export function sessionStamp(raw: string | null | undefined): string | null {
  const iso = toIsoDate(raw);
  if (!iso) return null;
  const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
  const pkt = new Date(new Date(iso).getTime() + PKT_OFFSET_MS);
  const midnightUtc = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate());
  return new Date(midnightUtc + 11 * 60 * 60 * 1000).toISOString(); // 16:00 PKT
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
  // A price of zero is a placeholder, not an endpoint: Sarmaaya prints "0.0 — 0.0" for a
  // symbol it has no range for (ENGRO does exactly this), and storing that would put a
  // meaningless 0 in a column that promises "unknown shows as a dash".
  const positive = (v: number | null): number | null => (v === null || v <= 0 ? null : v);

  const a = positive(toNumber(lowRaw));
  const b = positive(toNumber(highRaw));

  if (a === null || b === null) {
    return { low: a, high: b };
  }
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}
