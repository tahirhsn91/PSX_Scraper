import { childLogger } from '../utils/logger';
import { SiteUnavailableError } from '../types/errors';

/**
 * PSX's financial-announcement register — the source of confirmed corporate actions.
 *
 * The dividends table has never carried an ex-date (`dividends.ex_date` is null on every row), and
 * `corporate_actions` has never been populated, so the app cannot answer the one question every
 * total-return figure depends on: *when* did a payout or a bonus start trading without its cash?
 * This scraper fills that gap from the exchange itself.
 *
 * The register lives on `www.psx.com.pk`, which answers, unlike `dps.psx.com.pk` whose data paths
 * are refused at the edge (#27 — the same constraint that shaped `psxHolidays.scraper.ts`). It is
 * one server-rendered table with nine columns:
 *
 *   Company | Time | Year ended / Half year ended | Dividend / Bonus / Right |
 *   Profit before tax | Profit after tax | EPS | AGM/EOGM | Closure of Share Transfer Books
 *
 * Two of those columns carry the facts this module needs:
 *
 *  1. **`Dividend / Bonus / Right`** — a percentage with a marker, e.g. `40%(iii) (D)`,
 *     `10% (B)`, `100% AT A DISCOUNT OF RS. 5/= PER SHARES (R)`, and occasionally two actions in
 *     one cell separated by ` - ` (`50% (B) - 30%(i) (D)`).
 *     `(D)` cash dividend, `(B)` bonus issue, `(R)` right issue; the optional `(i)/(ii)/(iii)/(F)`
 *     is the interim number or final, which does not change the maths.
 *
 *  2. **`Closure of Share Transfer Books`** — the record-date range, `10/11/2026 - 12/11/2026`.
 *
 * The ex-date is derived, not published on this page: PSX trades a scrip *ex-* the entitlement two
 * trading days before the share transfer books close, so ex-date = second trading day before the
 * closure start, with weekends and the exchange's published holidays skipped. The rule is applied
 * by `exDateFor`, which takes the holiday set as an argument so it can be tested without a network.
 *
 * What this page does NOT give:
 *
 *  - **History.** The register is a rolling window of current-period announcements — the capture
 *    behind the first import carried 1,057 closure dates, every one of them in 2026. A backfill
 *    therefore reaches back only as far as the page does; older actions stay unknown, and the
 *    performance code says so rather than assuming no dividend was paid.
 *  - **A cash amount.** The percentage is of *face value*, and face value is not stored on `Stock`.
 *    A `CASH_DIVIDEND` row therefore carries a null amount unless it can be matched to a stored
 *    dividend row, whose rupee amount is already known (see `corporateActionIngest.service.ts`).
 *
 * Nothing here is inferred from prices: an action exists because the exchange announced it.
 */

export const ANNOUNCEMENTS_URL = 'https://www.psx.com.pk/psx/announcement/financial-announcements';
export const SOURCE = 'psx-financial-announcements';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export type ActionType = 'CASH_DIVIDEND' | 'BONUS' | 'SPLIT' | 'RIGHTS';

export interface ParsedAction {
  type: ActionType;
  /** The percentage as published — of face value for a dividend/right, of shares held for a bonus. */
  percent: number;
  /**
   * The price factor the action implies, as `ratioFrom` / `ratioTo`, for the adjustments engine.
   * A bonus of p% multiplies every earlier price by `100 / (100 + p)`, which is what
   * `ratioFrom = 100, ratioTo = 100 + p` encodes. Null for actions that do not change the share
   * count (cash, rights) — the engine ignores those and the action is still stored.
   */
  ratioFrom: number | null;
  ratioTo: number | null;
}

export interface CorporateActionAnnouncement {
  /** The company as the register prints it, including any `(TICKER)` suffix. */
  company: string;
  /** The ticker when the register prints one — not every row does. */
  ticker: string | null;
  /** The raw `Dividend / Bonus / Right` cell. */
  rawAction: string;
  actions: ParsedAction[];
  /** First and last day of the share-transfer-book closure (record dates). */
  closureStart: string;
  closureEnd: string;
  /** Ex-date per the T-2 rule, or null when the closure dates could not be read. */
  exDate: string | null;
  /** The `Year ended` cell, e.g. `30/09/2026(IIIQ)`. */
  period: string;
}

/** Text of a cell: tags out, entities unescaped, whitespace collapsed. */
function cellText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `10/11/2026` -> `2026-11-10`; null when the value is not a real date. */
export function parseDdMmYyyy(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;

/**
 * The second trading day before `day` — PSX's ex-date rule for a book closure.
 *
 * Weekends and listed holidays are skipped; a holiday that is missing from `holidays` cannot be
 * skipped, which is why the caller loads the years the closure dates fall in rather than guessing.
 */
export function exDateFor(day: string, holidays: ReadonlySet<string> = new Set()): string | null {
  const start = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(start)) return null;
  let cursor = start;
  let steps = 0;
  // Ten calendar days is enough to clear two trading days across any Eid closure PSX has published.
  for (let i = 0; i < 10 && steps < 2; i += 1) {
    cursor -= DAY;
    const d = new Date(cursor);
    const weekday = d.getUTCDay();
    const iso = isoDay(cursor);
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.has(iso)) continue;
    steps += 1;
  }
  if (steps < 2) return null;
  return isoDay(cursor);
}

/**
 * The actions in one `Dividend / Bonus / Right` cell.
 *
 * A cell can carry two actions (`50% (B) - 30%(i) (D)`), so it is split on ` - ` first. Each part
 * contributes at most one action: the first percentage is the entitlement, and the marker in
 * parentheses decides the type. A part with no recognised marker is dropped rather than guessed —
 * the register prints `-` for "nothing to report" and the parser must not turn that into an action.
 */
export function parseActionCell(cell: string): ParsedAction[] {
  const clean = cell.replace(/\s+/g, ' ').trim();
  if (!clean || clean === '-' || clean === '&nbsp;') return [];
  const out: ParsedAction[] = [];
  for (const part of clean.split(/\s+-\s+/)) {
    const percentMatch = /(\d+(?:\.\d+)?)\s*%/.exec(part);
    const marker = /\((D|B|R)\)\s*$/i.exec(part.trim());
    if (!percentMatch || !marker) continue;
    const percent = Number(percentMatch[1] ?? '0');
    if (!(percent > 0)) continue;
    const kind = (marker[1] ?? '').toUpperCase();
    if (kind === 'D') {
      out.push({ type: 'CASH_DIVIDEND', percent, ratioFrom: null, ratioTo: null });
    } else if (kind === 'B') {
      out.push({ type: 'BONUS', percent, ratioFrom: 100, ratioTo: 100 + percent });
    } else {
      out.push({ type: 'RIGHTS', percent, ratioFrom: null, ratioTo: null });
    }
  }
  return out;
}

/** `10/11/2026 - 12/11/2026` -> the two ends; a single date is its own range. */
export function parseClosure(cell: string): { start: string; end: string } | null {
  const parts = cell
    .split(/\s*-\s*/)
    .map((p) => parseDdMmYyyy(p))
    .filter((v): v is string => v != null);
  if (parts.length === 0) return null;
  return { start: parts[0] as string, end: parts[parts.length - 1] as string };
}

/**
 * Every corporate action on the register page.
 *
 * Rows without a readable closure date, or whose action cell carries no recognised marker, are
 * skipped — a partial row is worse than a missing one, because it would place a real payout on a
 * guessed date.
 */
export function parseAnnouncementTable(html: string, holidays: ReadonlySet<string> = new Set()): CorporateActionAnnouncement[] {
  const out: CorporateActionAnnouncement[] = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText);
    if (cells.length < 9) continue;
    const [company = '', , period = '', actionCell = '', , , , , closureCell = ''] = cells;
    if (!company || /^company$/i.test(company)) continue;

    const actions = parseActionCell(actionCell);
    if (actions.length === 0) continue;
    const closure = parseClosure(closureCell);
    if (!closure) continue;

    const tickerMatch = /\(([A-Z0-9]{2,12})\)\s*$/.exec(company);
    out.push({
      company,
      ticker: tickerMatch?.[1] ?? null,
      rawAction: actionCell,
      actions,
      closureStart: closure.start,
      closureEnd: closure.end,
      exDate: exDateFor(closure.start, holidays),
      period,
    });
  }
  return out;
}

/** The live register, parsed. Throws `SiteUnavailableError` when PSX cannot be read. */
export async function fetchPsxCorporateActions(
  holidays: ReadonlySet<string> = new Set(),
): Promise<CorporateActionAnnouncement[]> {
  const log = childLogger({ op: 'psx-corporate-actions' });
  let res: Response;
  try {
    res = await fetch(ANNOUNCEMENTS_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new SiteUnavailableError(`${SOURCE}: ${(err as Error).message.slice(0, 80)}`);
  }
  if (!res.ok) throw new SiteUnavailableError(`${SOURCE}: http ${res.status}`);

  const actions = parseAnnouncementTable(await res.text(), holidays);
  if (actions.length === 0) throw new SiteUnavailableError(`${SOURCE}: carried no corporate-action rows`);
  log.info('corporate-actions.parsed', {
    rows: actions.length,
    first: actions[0]?.exDate,
    last: actions.at(-1)?.exDate,
  });
  return actions;
}
