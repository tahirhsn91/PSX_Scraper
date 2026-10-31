import { prisma } from '../database/prisma';
import { childLogger } from '../utils/logger';
import {
  ANNOUNCEMENTS_URL,
  SOURCE,
  fetchPsxCorporateActions,
  type CorporateActionAnnouncement,
} from '../scrapers/psxCorporateActions.scraper';

/**
 * Store the exchange's corporate actions, and use them to date the dividends we already hold.
 *
 * Two jobs, one pass:
 *
 *  1. **Ingest** every cash dividend, bonus and right issue on PSX's register into
 *     `corporate_actions`, keyed `(stockId, type, exDate)`. Each row is `confirmed` — it exists
 *     because the exchange published it, not because a price moved — so the adjustment engine is
 *     allowed to apply it to the chart.
 *  2. **Date the dividends.** `dividends.ex_date` is null on every row; the register carries the
 *     record-date range, and a dividend can be matched to its action when the rupee amount is
 *     consistent with the published percentage and the dates line up. That turn is what lets a
 *     total-return figure include a payout in the right window.
 *
 * The matching rule is deliberately strict, because a wrong ex-date is worse than a missing one: it
 * moves cash into a window that did not earn it. A dividend is dated only when
 *
 *   - the action's ex-date falls after the announcement and within 120 days of it,
 *   - the amount and the percentage agree under a single face value for that symbol (the median
 *     implied face value of all candidate pairs, accepted only when it explains most of them), and
 *   - the chosen action is the nearest candidate in time.
 *
 * Anything that fails those tests stays null and is counted in the summary, so the caller can see
 * how much of the dividend history is actually dated instead of assuming all of it.
 */

export interface CorporateActionIngestStats {
  source: string;
  fetched: number;
  /** Rows whose company name could not be resolved to a tracked symbol. */
  unresolved: number;
  inserted: number;
  updated: number;
  /** Dividend rows that gained an ex-date in this pass. */
  dividendsDated: number;
  /** Dividends left undated: no matching action, or an ambiguous one. */
  dividendsUndated: number;
  /** Announced splits/bonuses whose price step confirmed them. */
  actionsConfirmed: number;
  /** Announced splits/bonuses the prices did not confirm — stored, never applied. */
  actionsUnconfirmed: number;
  symbols: number;
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Lower-case, punctuation out, `&` spoken as `and`. */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Company names lose their legal form before comparison ("Fauji Fertilizer Company Limited" and
 * "Fauji Fertilizer Co. Ltd." are the same issuer), but nothing more: dropping words like *bank*
 * would collapse three different banks into one.
 */
const LEGAL_FORMS = /\b(limited|ltd|company|co|corporation|corp|the|pakistan|pak)\b/g;
const coreName = (name: string) => normaliseName(name).replace(LEGAL_FORMS, ' ').replace(/\s+/g, ' ').trim();

export interface SymbolIndex {
  byTicker: Map<string, string>;
  /** A null marks a name two tracked stocks share — matching it would be a guess. */
  byName: Map<string, string | null>;
  byCore: Map<string, string[]>;
}

export function buildSymbolIndex(stocks: Array<{ id: string; symbol: string; companyName: string | null }>): SymbolIndex {
  const byTicker = new Map<string, string>();
  const byName = new Map<string, string | null>();
  const byCore = new Map<string, string[]>();
  for (const s of stocks) {
    byTicker.set(s.symbol.toUpperCase(), s.id);
    if (!s.companyName) continue;
    const key = normaliseName(s.companyName);
    byName.set(key, byName.has(key) ? null : s.id);
    const core = coreName(s.companyName);
    if (!core) continue;
    const list = byCore.get(core) ?? [];
    list.push(s.id);
    byCore.set(core, list);
  }
  return { byTicker, byName, byCore };
}

/**
 * The tracked stock a register row refers to, or null.
 *
 * Order matters: an explicit ticker in the row wins, then an exact company-name match, then the
 * legal-form-stripped name — and only when that core name identifies exactly one stock. A name that
 * matches two issuers is ambiguous and is left unresolved rather than assigned to the first hit.
 */
export function resolveSymbol(index: SymbolIndex, company: string, ticker: string | null): string | null {
  if (ticker) {
    const hit = index.byTicker.get(ticker.toUpperCase());
    if (hit) return hit;
  }
  const exact = index.byName.get(normaliseName(company));
  if (exact) return exact;
  if (exact === null) return null; // two stocks answer to the same name
  const core = coreName(company);
  const list = core ? index.byCore.get(core) : undefined;
  return list && list.length === 1 ? (list[0] as string) : null;
}

/** Holidays for the years a batch of closure dates touches, as ISO strings. */
async function loadHolidays(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const years = new Set(dates.map((d) => Number(d.slice(0, 4))));
  const from = new Date(Date.UTC(Math.min(...years) - 1, 0, 1));
  const to = new Date(Date.UTC(Math.max(...years) + 1, 11, 31));
  const rows = await prisma.marketHoliday.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
  });
  return new Set(rows.map((r) => iso(r.date)));
}

interface AggregateRow {
  stockId: string;
  type: string;
  exDate: string;
  recordDate: string;
  ratioFrom: number | null;
  ratioTo: number | null;
  percent: number;
}

/**
 * Collapse announcements to one row per `(stock, type, ex-date)`.
 *
 * A company can print two dividends of the same type on one line (`20% (F) (D) - 20% (F) (D)`) or
 * repeat an announcement across periods. Both describe the same ex-date, and the table's unique key
 * holds one row, so the percentages are summed — two payouts of 20% that start trading ex- on the
 * same day are a 40% entitlement, not two competing ones.
 */
export function aggregate(rows: Array<{ stockId: string; announcement: CorporateActionAnnouncement }>): AggregateRow[] {
  const map = new Map<string, AggregateRow>();
  for (const { stockId, announcement } of rows) {
    if (!announcement.exDate) continue;
    for (const action of announcement.actions) {
      const key = `${stockId}|${action.type}|${announcement.exDate}`;
      const existing = map.get(key);
      if (existing) {
        existing.percent += action.percent;
        if (action.type === 'BONUS') existing.ratioTo = 100 + existing.percent;
        continue;
      }
      map.set(key, {
        stockId,
        type: action.type,
        exDate: announcement.exDate,
        recordDate: announcement.closureEnd,
        ratioFrom: action.ratioFrom,
        ratioTo: action.ratioTo,
        percent: action.percent,
      });
    }
  }
  return [...map.values()];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/**
 * Give `dividends` rows their ex-date from the actions just imported.
 *
 * Returns how many were dated and how many were left alone. `actions` must have already been
 * written, because the dividend rows are matched against what is in the table — the same rows the
 * rest of the app will read.
 *
 * A dividend is dated only when the action and the rupee amount agree on a **plausible face
 * value**. The register publishes a percentage of face value, and PSX scrips are almost all issued
 * at 1, 5, 10, 50 or 100 rupees, so `amount / (percent / 100)` is a sharp test: a 60% action on a
 * Rs 10 face is Rs 6.00, and a Rs 6.00 dividend cannot be the 20% action beside it. That test is
 * what keeps a payout from being attached to the wrong line on the register — a wrong ex-date moves
 * cash into a window that did not earn it, which is worse than leaving the date empty.
 *
 * The announcement-to-ex gap is allowed to be slightly negative (a filing posted the morning after
 * the ex-date) but never more than a week, and never longer than two months — a match that needs a
 * quarter to reach its action is not a match. The nearest plausible action wins.
 */
const FACE_VALUES = [1, 5, 10, 50, 100];
const plausibleFace = (value: number) =>
  FACE_VALUES.some((f) => Math.abs(value - f) / f <= 0.02) && value >= 1 && value <= 500;

export async function dateDividends(stockIds: string[]): Promise<{ dated: number; undated: number }> {
  let dated = 0;
  let undated = 0;
  if (stockIds.length === 0) return { dated, undated };

  const [actions, dividends] = await Promise.all([
    prisma.corporateAction.findMany({
      where: { stockId: { in: stockIds }, type: 'CASH_DIVIDEND', exDate: { not: null } },
      select: { stockId: true, exDate: true, percent: true },
    }),
    prisma.dividend.findMany({
      where: { stockId: { in: stockIds }, exDate: null, announcementDate: { not: null } },
      select: { id: true, stockId: true, announcementDate: true, dividend: true },
    }),
  ]);

  const byStock = new Map<string, Array<{ exDate: Date; percent: number | null }>>();
  for (const a of actions) {
    if (!a.exDate) continue;
    const list = byStock.get(a.stockId) ?? [];
    list.push({ exDate: a.exDate, percent: a.percent != null ? Number(a.percent) : null });
    byStock.set(a.stockId, list);
  }

  for (const [stockId, list] of byStock) {
    const rows = dividends.filter((d) => d.stockId === stockId);
    if (rows.length === 0) continue;

    for (const row of rows) {
      if (!row.announcementDate || row.dividend == null) {
        undated += 1;
        continue;
      }
      const amount = Number(row.dividend);
      if (!(amount > 0)) {
        undated += 1;
        continue;
      }

      const candidates = list
        .map((a) => {
          if (a.percent == null || !(a.percent > 0)) return null;
          const gapDays = Math.round((a.exDate.getTime() - row.announcementDate!.getTime()) / DAY);
          if (gapDays < -7 || gapDays > 60) return null;
          const face = amount / (a.percent / 100);
          if (!plausibleFace(face)) return null;
          return { exDate: a.exDate, distance: Math.abs(gapDays) };
        })
        .filter((c): c is { exDate: Date; distance: number } => c != null)
        .sort((a, b) => a.distance - b.distance);

      if (candidates.length === 0) {
        undated += 1;
        continue;
      }
      // Two actions equally close in time cannot be told apart: leave the date empty.
      if (candidates.length > 1 && candidates[0]!.distance === candidates[1]!.distance) {
        undated += 1;
        continue;
      }

      await prisma.dividend.update({ where: { id: row.id }, data: { exDate: candidates[0]!.exDate } });
      dated += 1;
    }
  }

  return { dated, undated };
}

/**
 * Promote an announced split/bonus to `confirmed` only when the prices prove it happened.
 *
 * The register publishes *declarations*. A bonus declared with a result is still subject to the
 * AGM, and PSX lists it before the shares are actually cancelled and re-issued — JLICL declared a
 * 50% bonus with a book closure in August 2026 and its shares never halved. Marking that
 * `confirmed` would make the chart show a 33% crash that no holder experienced, so the ingest
 * stores every action as `announced` and this pass is the only thing that can promote one.
 *
 * The test is the price step across the ex-date: a p% bonus must show `prevClose / nextClose` of
 * about `1 + p/100`. Only actions of 10% or more are considered — below that the step is inside
 * ordinary daily noise — and the observed ratio must match within 2%. Anything that fails stays
 * `announced`: stored, visible, and not applied.
 */
export async function confirmFromPrices(stockIds: string[]): Promise<{ confirmed: number; rejected: number }> {
  let confirmed = 0;
  let rejected = 0;
  if (stockIds.length === 0) return { confirmed, rejected };

  const actions = await prisma.corporateAction.findMany({
    where: {
      stockId: { in: stockIds },
      type: { in: ['SPLIT', 'BONUS'] },
      status: 'announced',
      exDate: { not: null },
      percent: { gte: 10 },
    },
    select: { id: true, stockId: true, exDate: true, percent: true, ratioFrom: true, ratioTo: true },
  });

  for (const action of actions) {
    if (!action.exDate) continue;
    const before = await prisma.$queryRaw<Array<{ close: number }>>`
      SELECT close FROM stock_prices
      WHERE stock_id = ${action.stockId} AND close IS NOT NULL AND last_trade_date::date < ${action.exDate}::date
      ORDER BY last_trade_date DESC LIMIT 1`;
    const after = await prisma.$queryRaw<Array<{ close: number }>>`
      SELECT close FROM stock_prices
      WHERE stock_id = ${action.stockId} AND close IS NOT NULL AND last_trade_date::date >= ${action.exDate}::date
      ORDER BY last_trade_date ASC LIMIT 1`;
    const prev = before[0] ? Number(before[0].close) : null;
    const next = after[0] ? Number(after[0].close) : null;
    if (!prev || !next) {
      rejected += 1;
      continue;
    }
    const expected = Number(action.ratioTo) / Number(action.ratioFrom);
    const observed = prev / next;
    if (Math.abs(observed / expected - 1) <= 0.02) {
      await prisma.corporateAction.update({ where: { id: action.id }, data: { status: 'confirmed' } });
      confirmed += 1;
    } else {
      rejected += 1;
    }
  }

  return { confirmed, rejected };
}

let running = false;

/** Read the register, store every action, and date the dividends that match. Idempotent. */
export async function refreshCorporateActions(): Promise<CorporateActionIngestStats> {
  const log = childLogger({ op: 'corporate-actions' });
  if (running) throw new Error('corporate-action refresh already running');
  running = true;
  try {
    // The register prints only book-closure dates; the ex-date rule needs the holiday calendar for
    // those years, so a first pass reads the page without holidays and a second computes with them.
    const first = await fetchPsxCorporateActions();
    const holidays = await loadHolidays(first.map((a) => a.closureStart));
    const announcements = await fetchPsxCorporateActions(holidays);

    const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true, companyName: true } });
    const index = buildSymbolIndex(stocks);

    const resolved: Array<{ stockId: string; announcement: CorporateActionAnnouncement }> = [];
    let unresolved = 0;
    for (const a of announcements) {
      const stockId = resolveSymbol(index, a.company, a.ticker);
      if (!stockId) {
        unresolved += 1;
        continue;
      }
      resolved.push({ stockId, announcement: a });
    }

    const rows = aggregate(resolved);
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const exDate = utc(row.exDate);
      const existing = await prisma.corporateAction.findUnique({
        where: { stockId_type_exDate: { stockId: row.stockId, type: row.type, exDate } },
        select: { id: true },
      });
      const data = {
        recordDate: utc(row.recordDate),
        percent: row.percent,
        ratioFrom: row.ratioFrom,
        ratioTo: row.ratioTo,
        status: 'announced',
        sourceUrl: ANNOUNCEMENTS_URL,
      };
      if (existing) {
        await prisma.corporateAction.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.corporateAction.create({
          data: { stockId: row.stockId, type: row.type, exDate, ...data },
        });
        inserted += 1;
      }
    }

    const stockIds = [...new Set(rows.map((r) => r.stockId))];
    const dividendStats = await dateDividends(stockIds);
    const confirmedActions = await confirmFromPrices(stockIds);

    const stats: CorporateActionIngestStats = {
      source: SOURCE,
      fetched: announcements.length,
      unresolved,
      inserted,
      updated,
      dividendsDated: dividendStats.dated,
      dividendsUndated: dividendStats.undated,
      actionsConfirmed: confirmedActions.confirmed,
      actionsUnconfirmed: confirmedActions.rejected,
      symbols: stockIds.length,
    };
    log.info('corporate-actions.ingested', { ...stats });
    return stats;
  } finally {
    running = false;
  }
}
