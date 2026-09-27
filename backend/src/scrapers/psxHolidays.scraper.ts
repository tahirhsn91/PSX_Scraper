import { childLogger } from '../utils/logger';
import { SiteUnavailableError } from '../types/errors';

/**
 * PSX's published market holidays, from the exchange's own Calendar Holidays page.
 *
 * The trading calendar this pipeline assumed was "Monday-Friday, 09:30-15:30 PKT"
 * (`utils/marketHours.ts`), and under that rule a weekday holiday is indistinguishable from a
 * trading weekday. The result is in the data: 2026-08-26, a Wednesday the exchange never opened,
 * exists in `stock_prices` as 441 rows with `volume = 0` and the previous session's close copied
 * in, and the index board's session stamp wrote its row before the open.
 *
 * The page is on `www.psx.com.pk`, which answers — unlike `dps.psx.com.pk`, whose data paths are
 * refused at the edge (#27). It is one server-rendered table, so no rendering pass is needed:
 *
 *   <tr><td>4</td><td>Eid-ul-Fitr*</td>
 *     <td>(1<sup>st</sup>, 2<sup>nd</sup> and 3<sup>rd</sup> Shawal 1447 AH) - Saturday, Sunday
 *         &amp; Monday 21<sup>st</sup>, 22<sup>nd</sup> &amp; 23<sup>rd</sup> March 2026</td>
 *     <td>3</td></tr>
 *
 * Two properties of that markup decide the parser's shape:
 *
 *  1. Ordinals keep a space once the tags are stripped ("5 th", "21 st"), so day numbers only
 *     become readable after `N (st|nd|rd|th)` is collapsed to `N`.
 *  2. A multi-day holiday is ONE cell: the Gregorian days sit in a comma/& list before the month,
 *     while a Hijri range sits in parentheses and must not be read as Gregorian days. The parser
 *     drops parenthesised text, takes the month and year from what remains, and reads every day
 *     number before the month. Anything it cannot resolve to a real date is skipped - never
 *     guessed, and never turned into a session.
 *
 * A holiday ON THIS LIST is not proof the market closed, and its absence is not proof it opened.
 * The list is published in advance, and an Eid observance can land a day either side of it: PSX
 * lists Eid Milad-un-Nabi on Tuesday 25 August 2026, while both independent calendars that publish
 * PSX sessions (Sarmaaya's `volume-history` and stockanalysis.com) carry 25 August as a session
 * and omit 26 August - and our own rows agree with them (25 August traded ~3M shares of OGDC,
 * 26 August wrote 441 rows at zero volume). Treat this list as advisory corroboration for the
 * session gate, never as the last word on whether a session happened.
 */
export const CALENDAR_URL = 'https://www.psx.com.pk/psx/exchange/general/calendar-holidays';
export const SOURCE = 'psx-calendar-holidays';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export interface MarketHoliday {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** The holiday as PSX names it. */
  name: string;
  /** The "No. of Days" column as published - the entry's declared length, null when absent. */
  days: number | null;
  /**
   * True when PSX qualifies the closure ("For Christians only"). Those are not market-wide
   * closures, so they never stop a session on their own.
   */
  partial: boolean;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Text of a cell: tags out, entities unescaped, whitespace collapsed. */
function cellText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "5 th" / "21 st" / "3rd" -> "5" / "21" / "3". Tag stripping leaves the space behind. */
function collapseOrdinals(text: string): string {
  return text.replace(/(\d{1,2})\s*(?:st|nd|rd|th)\b/gi, '$1');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Every Gregorian date a single date cell names, sorted. Empty when the cell cannot be read -
 * the caller skips it rather than inventing a day.
 */
export function datesInCell(cell: string): string[] {
  // Parenthesised text is Hijri ("(1st, 2nd and 3rd Shawal 1447 AH)") and must contribute no days
  // and no year, so it goes first.
  const cleaned = collapseOrdinals(cell.replace(/\([^)]*\)/g, ' '));

  const named = (cleaned.match(/[A-Za-z]{3,9}/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => MONTHS[word] !== undefined);
  const months = new Set(named);
  // The page names one Gregorian month per cell. A cell naming two cannot be split into dates
  // without knowing which day belongs to which month, so it is skipped rather than guessed.
  if (months.size !== 1) return [];

  const month = MONTHS[[...months][0] as string] as number;
  const years = cleaned.match(/\b(?:19|20)\d{2}\b/g) ?? [];
  const year = Number(years.at(-1));
  if (!year) return [];

  // Both orders the exchange uses read the same way: "21st, 22nd & 23rd March 2026" (days first)
  // and "December 26th, 2024" (month first). The year is four digits and the Hijri range is gone,
  // so every one- or two-digit token left in the cell is a candidate day - filtered, below, against
  // the month it would land in.
  const dates = new Set<string>();
  for (const digits of cleaned.match(/\b\d{1,2}\b/g) ?? []) {
    const day = Number(digits);
    if (day < 1 || day > daysInMonth(year, month)) continue;
    dates.add(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return [...dates].sort();
}

/** The published holiday table, as dates. Pure, so it is tested against the captured page. */
export function parseHolidayTable(html: string): MarketHoliday[] {
  const byDate = new Map<string, MarketHoliday>();

  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText);
    if (cells.length < 3) continue;

    const serial = (cells[0] ?? '').trim();
    const name = (cells[1] ?? '').trim();
    const dateCell = cells[2] ?? '';
    // The header row and the table's "Total" footer are not holidays.
    if (!/^\d+$/.test(serial) || name === '' || /^total$/i.test(name)) continue;

    const dates = datesInCell(dateCell);
    if (dates.length === 0) continue;

    const declared = Number((cells[3] ?? '').trim());
    const days = Number.isFinite(declared) && declared > 0 ? declared : null;
    const partial = /for\s+[a-z-]+\s+only/i.test(dateCell);

    for (const date of dates) {
      if (!byDate.has(date)) byDate.set(date, { date, name, days, partial });
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The live page, parsed. Throws `SiteUnavailableError` when PSX cannot be read. */
export async function fetchPsxHolidays(): Promise<MarketHoliday[]> {
  const log = childLogger({ op: 'psx-holidays' });
  let res: Response;
  try {
    res = await fetch(CALENDAR_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new SiteUnavailableError(`${SOURCE}: ${(err as Error).message.slice(0, 80)}`);
  }
  if (!res.ok) throw new SiteUnavailableError(`${SOURCE}: http ${res.status}`);

  const holidays = parseHolidayTable(await res.text());
  if (holidays.length === 0) throw new SiteUnavailableError(`${SOURCE}: carried no holiday rows`);
  log.info('holidays.parsed', { count: holidays.length, first: holidays[0]?.date, last: holidays.at(-1)?.date });
  return holidays;
}
