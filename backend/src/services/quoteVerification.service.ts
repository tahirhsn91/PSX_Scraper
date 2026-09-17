/**
 * Decide whether a scraped quote is fit to be written.
 *
 * The rule agreed for the universe worker (#41): a value that fails is *not* written — the field
 * shows a dash — and the reason plus the raw scraped value go to the logs. That is deliberately
 * stricter than writing it with a flag: a dash never lies, and the raw value is still recoverable
 * from the log, whereas a suspect number sitting on the dashboard is indistinguishable from a
 * good one.
 *
 * Everything here is pure — the checks take the scraped numbers plus the small amount of context
 * they need (the previous close, the symbol's recent volume distribution) — so the rules can be
 * tested without a database or a network.
 */

/**
 * How far a change% may sit from the move implied by the stored previous close, in points.
 *
 * 2.5, not something tighter: the source's own consecutive readings for one symbol disagree by
 * up to ~1 point (LUCK's stored 15 Sep close of 414.80 at +2.12% implies a 16 Sep close of
 * 414.79, while its 16 Sep reading reports 408.92), because `change%` is published against the
 * source's own previous-close basis, which is not always the close in our table. At 1.0 the check
 * rejected a legitimate reading. It is here to catch a value that belongs to another symbol or
 * another day — a gross error — not to second-guess a point of basis difference.
 */
export const CHANGE_PERCENT_TOLERANCE = 2.5;

/** How far outside the 52-week range a price may sit before the range is treated as wrong. */
export const RANGE_TOLERANCE = 0.01; // 1%

export interface ScrapedQuote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  week52Low: number | null;
  week52High: number | null;
  /** The session the reading belongs to (ISO), from the source's own quote timestamp. */
  sessionDate: string | null;
}

export interface VerificationContext {
  /** Close of the previous accepted session, when we already have one. */
  previousClose: number | null;
  /** Median of the symbol's recent session volumes, when there is enough history. */
  volumeMedian: number | null;
  /** Reject a volume above `volumeMedian * maxVolumeMultiple`. */
  maxVolumeMultiple: number;
  /** A quote older than this many days is not a live listing. */
  maxQuoteAgeDays: number;
  /** Injection point for tests; defaults to now. */
  now?: Date;
}

export type QuoteField = 'price' | 'change' | 'changePercent' | 'volume' | 'week52Low' | 'week52High';

/**
 * `ok`      — the value is written.
 * `absent`  — the source carried nothing (normal for a security that rarely trades).
 * `rejected`— the source carried something that failed a check (worth a look in the log).
 */
export type VerdictStatus = 'ok' | 'absent' | 'rejected';

export interface FieldVerdict {
  field: QuoteField;
  status: VerdictStatus;
  /** The value to write; null unless `status` is `ok`. */
  value: number | null;
  /** The raw scraped value when it was not written — logged, never stored. */
  rawValue?: number | null;
  reason?: string;
}

export interface VerificationResult {
  /** False when the symbol must not be added or updated at all: not a live listing. */
  listed: boolean;
  notListedReason?: string;
  verdicts: FieldVerdict[];
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whole days between two instants on the UTC calendar (PKT dates are UTC+5, same day). */
function daysApart(a: Date, b: Date): number {
  const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round(Math.abs(dayA - dayB) / 86_400_000);
}

export function verifyQuote(quote: ScrapedQuote, ctx: VerificationContext): VerificationResult {
  const now = ctx.now ?? new Date();
  const verdicts: FieldVerdict[] = [];

  // 1. Is this a live listing at all?
  // A page that still shows a months-old quote is a delisted symbol whose page was never taken
  // down — ENGRO looks exactly like this (its last quote is stamped 2025-02-25) — and adding it
  // is precisely the mistake this check exists to prevent.
  const session = quote.sessionDate ? new Date(quote.sessionDate) : null;
  if (!session || Number.isNaN(session.getTime())) {
    return { listed: false, notListedReason: `no quote timestamp (${quote.sessionDate ?? 'null'})`, verdicts };
  }
  const age = daysApart(session, now);
  if (age > ctx.maxQuoteAgeDays) {
    return {
      listed: false,
      notListedReason: `quote is ${age} days old (${quote.sessionDate}), older than ${ctx.maxQuoteAgeDays}`,
      verdicts,
    };
  }

  // 2. Price — the field every other check is judged against.
  if (!finite(quote.price) || quote.price <= 0) {
    return { listed: false, notListedReason: `price not usable (${quote.price ?? 'null'})`, verdicts };
  }
  verdicts.push({ field: 'price', status: 'ok', value: quote.price });

  // 3. change / change% must agree with the move from the close we stored.
  const hasPrev = finite(ctx.previousClose) && ctx.previousClose > 0;
  if (!finite(quote.changePercent)) {
    verdicts.push({
      field: 'changePercent', status: 'absent', value: null, rawValue: quote.changePercent, reason: 'no change%',
    });
    verdicts.push({
      field: 'change', status: 'absent', value: null, rawValue: quote.change, reason: 'no change% to agree with',
    });
  } else if (hasPrev) {
    const implied = ((quote.price - ctx.previousClose!) / ctx.previousClose!) * 100;
    const drift = Math.abs(quote.changePercent - implied);
    const ok = drift <= CHANGE_PERCENT_TOLERANCE;
    verdicts.push({
      field: 'changePercent',
      status: ok ? 'ok' : 'rejected',
      value: ok ? quote.changePercent : null,
      rawValue: quote.changePercent,
      ...(ok
        ? {}
        : {
            reason:
              `change% ${quote.changePercent} disagrees with ${implied.toFixed(2)}% implied by ` +
              `previous close ${ctx.previousClose} (drift ${drift.toFixed(2)}pp)`,
          }),
    });
    // `change` is the same reading in absolute terms: if the percentage cannot be trusted, the
    // absolute figure cannot be either.
    verdicts.push({
      field: 'change',
      status: ok ? 'ok' : 'rejected',
      value: ok ? (finite(quote.change) ? quote.change : null) : null,
      rawValue: quote.change,
      ...(ok ? {} : { reason: 'change% disagreed with the previous close' }),
    });
  } else {
    // No stored previous close (a symbol we are seeing for the first time), so there is nothing
    // to cross-check against — the value is taken as-is rather than treated as suspect.
    verdicts.push({ field: 'changePercent', status: 'ok', value: quote.changePercent });
    verdicts.push({
      field: 'change',
      status: finite(quote.change) ? 'ok' : 'absent',
      value: finite(quote.change) ? quote.change : null,
      rawValue: quote.change,
      ...(finite(quote.change) ? {} : { reason: 'no change' }),
    });
  }

  // 4. Volume — 0 is a reading (a session that printed no trades), not a gap.
  if (!finite(quote.volume) || quote.volume < 0) {
    verdicts.push({
      field: 'volume', status: 'absent', value: null, rawValue: quote.volume,
      reason: `volume not usable (${quote.volume ?? 'null'})`,
    });
  } else if (finite(ctx.volumeMedian) && ctx.volumeMedian > 0 && quote.volume > ctx.volumeMedian * ctx.maxVolumeMultiple) {
    // Catches a truncated/concatenated number, which shows up as an absurd multiple of what this
    // symbol normally trades.
    verdicts.push({
      field: 'volume', status: 'rejected', value: null, rawValue: quote.volume,
      reason:
        `volume ${quote.volume} is more than ${ctx.maxVolumeMultiple}x this symbol's recent ` +
        `median (${ctx.volumeMedian})`,
    });
  } else {
    verdicts.push({ field: 'volume', status: 'ok', value: quote.volume });
  }

  // 5. The 52-week range, judged as a pair: it is only meaningful if it brackets the price.
  const low = quote.week52Low;
  const high = quote.week52High;
  if (!finite(low) || !finite(high) || low <= 0 || high <= 0 || low >= high) {
    const reason = `52W range not usable (low ${low ?? 'null'}, high ${high ?? 'null'})`;
    verdicts.push({ field: 'week52Low', status: 'absent', value: null, rawValue: low, reason });
    verdicts.push({ field: 'week52High', status: 'absent', value: null, rawValue: high, reason });
  } else if (quote.price < low * (1 - RANGE_TOLERANCE) || quote.price > high * (1 + RANGE_TOLERANCE)) {
    // Price and range disagree. The range is the block we trust less (a derived figure off the
    // page), so it is dropped and the price kept — with both raw values logged so the
    // disagreement stays visible instead of being silently resolved.
    const reason = `price ${quote.price} outside 52W range ${low}-${high}`;
    verdicts.push({ field: 'week52Low', status: 'rejected', value: null, rawValue: low, reason });
    verdicts.push({ field: 'week52High', status: 'rejected', value: null, rawValue: high, reason });
  } else {
    verdicts.push({ field: 'week52Low', status: 'ok', value: low });
    verdicts.push({ field: 'week52High', status: 'ok', value: high });
  }

  return { listed: true, verdicts };
}

/** The fields that will be written. */
export function acceptedValues(v: VerificationResult): Partial<Record<QuoteField, number>> {
  const out: Partial<Record<QuoteField, number>> = {};
  for (const verdict of v.verdicts) {
    if (verdict.status === 'ok' && verdict.value !== null) out[verdict.field] = verdict.value;
  }
  return out;
}

/** The fields that carried nothing, or carried something that failed a check. */
export function unwrittenVerdicts(v: VerificationResult): FieldVerdict[] {
  return v.verdicts.filter((x) => x.status !== 'ok');
}
