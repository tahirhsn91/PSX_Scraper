import { IStockScraper } from '../types/scraper';
import { DividendDTO, IncomeStatementDTO, IncomeStatementLineDTO, RatioDTO, ScrapeResult } from '../types/dto';
import { childLogger } from '../utils/logger';
import { sourceBreaker } from '../utils/sourceBreaker';
import { SCRAPER_USER_AGENT } from '../utils/userAgent';
import { SiteUnavailableError } from '../types/errors';

/**
 * Valuation ratios, book value per share and dividend history over plain HTTP — no browser.
 *
 * Why this exists (#79): the app's Valuation card rendered seven dashes because the ratios we
 * stored were empty. The rows *were* being written — `ratios` held 64,709 of them, `pe_ratio`
 * populated in **0** — and the writer behind that was the Sarmaaya **page** extractor: the site is
 * a Next.js app whose ratio block is no longer in `tr`/`.stat`/`.metric` markup, so every labelled
 * read returned null and a full row of nulls was persisted on each sync. Worse, that row was the
 * *newest*, and the detail read path serves the newest one, so a partial page parse blanked the
 * card even when an earlier row had held a real figure.
 *
 * The same figures are published as JSON by the API that page calls, on the host this repo already
 * uses for quotes (no key, no browser):
 *
 *  - `POST /api/stocks/details/{SYMBOL}` (body `{}`) — the metric table: `FF_PE`, `FF_PBK`,
 *    `FF_DIV_YLD`, `FF_EPS`, market cap, shares outstanding, free float, the day's price block and
 *    the 52-week range. Verified 2026-09-27 for EFERT: P/E 12.48, P/B 5.95, dividend yield 6.16.
 *  - `GET  /api/stocks/fundamentals/ratios?isin={ISIN}&periodicity=LTM|ANN` — the per-period ratio
 *    series, which is the **only** place book value per share is published: "Book Value Per Share"
 *    (`FF_BPS`). EFERT TTM 32.842 / FY2025 33.511. Nothing in the details payload carries it.
 *  - `GET  /api/stocks/dividends/{SYMBOL}` — `payoutHistory`, newest announcement first, with
 *    `announcementDate` and `dividendPerShare`.
 *
 * Two things this module deliberately does not do. It does not touch the price block or the sector
 * (the page scraper owns those, and a second writer for a row keyed by session is a clobbering
 * risk), and it does not derive book value from `price / (price-to-book)`: the source publishes the
 * figure, so we read it, and a genuinely absent one stays null and renders as a dash.
 *
 * The period requested for the ratio series is **TTM (LTM)**, the column the site's own ratios
 * table calls current: it is the figure that reconciles with the source's own current P/B
 * (195.27 / 32.842 = 5.946 against a published 5.95) and it moves quarterly, where the annual
 * series only moves once a year. The annual series is the per-field fallback when TTM publishes no
 * book value for a symbol.
 */

export const SARMAYA_API_BASE = 'https://beta-restapi.sarmaaya.pk';
export const SARMAYA_FUNDAMENTALS_SOURCE = 'sarmaaya-fundamentals';

/** Long enough for the ~100 KB ratio series on a slow link; every request sets it. */
const REQUEST_TIMEOUT_MS = 20000;

export const sarmaayaDetailsUrl = (symbol: string): string =>
  `${SARMAYA_API_BASE}/api/stocks/details/${encodeURIComponent(symbol.toUpperCase())}`;

export const sarmaayaDividendsUrl = (symbol: string): string =>
  `${SARMAYA_API_BASE}/api/stocks/dividends/${encodeURIComponent(symbol.toUpperCase())}`;

export const sarmaayaRatioSeriesUrl = (isin: string, periodicity: 'LTM' | 'ANN'): string =>
  `${SARMAYA_API_BASE}/api/stocks/fundamentals/ratios?isin=${encodeURIComponent(isin)}&periodicity=${periodicity}`;

export const sarmaayaIncomeStatementUrl = (isin: string, periodicity: 'LTM' | 'ANN'): string =>
  `${SARMAYA_API_BASE}/api/stocks/fundamentals/income-statement?isin=${encodeURIComponent(isin)}&periodicity=${periodicity}`;

/**
 * A number, or null for anything that is not one.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so without the guard an *absent* metric would be
 * stored as a real zero — a fabricated figure in a column that promises a dash for "unknown".
 * The API quotes every value as a string (`"afValue": "15.94"`), which is also why the coercion
 * happens here rather than at the call site.
 */
export function asNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/,/g, '');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * The source publishes D/E as a percentage ("Debt to Equity (%)"); the app stores and scores it as
 * the ratio it names (0.63, not 63.3), which is what "D/E ≤ 1" means in the scoring benchmark.
 */
function pctToRatio(raw: number | null): number | null {
  return raw === null ? null : raw / 100;
}

/** The metric codes this module reads, so an unexpected one cannot leak into a column. */
const METRIC = {
  pe: 'FF_PE',
  pb: 'FF_PBK',
  dividendYield: 'FF_DIV_YLD',
  eps: 'FF_EPS',
  netProfitMargin: 'FF_NET_MGN',
  freeFloatShares: 'FF_SHS_FLOAT',
  freeFloatPercent: 'FF_SHS_FLOAT_PERCENT',
} as const;

export interface SarmaayaDetails {
  /** Every metric row carries the ISIN, which is what the ratio-series endpoint is addressed by. */
  isin: string | null;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  eps: number | null;
  netProfitMargin: number | null;
  freeFloatShares: number | null;
  freeFloatPercent: number | null;
}

/**
 * Read the metric table. One row per metric, `{ metricMetric, metricName, afValue }`.
 *
 * Only the four codes above are taken; a metric the payload omits stays null. Unknown codes are
 * ignored rather than guessed at by name — a label is text that can be reworded, a metric code is
 * the source's own key.
 */
export function parseSarmaayaDetails(payload: unknown): SarmaayaDetails {
  const rows = (payload as { response?: unknown } | null)?.response;
  if (!Array.isArray(rows)) {
    return {
      isin: null, peRatio: null, pbRatio: null, dividendYield: null, eps: null,
      netProfitMargin: null, freeFloatShares: null, freeFloatPercent: null,
    };
  }

  // One entry per code today (measured across eight symbols: all distinct), but a repeated code
  // would mean the source is listing several fiscal periods, and then the newest one is the
  // reading — never the first row to happen to arrive.
  const byCode = new Map<string, { raw: unknown; year: number }>();
  let isin: string | null = null;
  for (const row of rows as Record<string, unknown>[]) {
    const code = typeof row.metricMetric === 'string' ? row.metricMetric : null;
    if (isin === null && typeof row.isin === 'string' && row.isin.trim()) isin = row.isin.trim();
    if (!code) continue;
    const numeric = (row.afFiscalYear as number | undefined);
    const year = typeof numeric === 'number' ? numeric : 0;
    const seen = byCode.get(code);
    if (!seen || year >= seen.year) byCode.set(code, { raw: row.afValue, year });
  }

  return {
    isin,
    peRatio: asNumber(byCode.get(METRIC.pe)?.raw),
    pbRatio: asNumber(byCode.get(METRIC.pb)?.raw),
    dividendYield: asNumber(byCode.get(METRIC.dividendYield)?.raw),
    eps: asNumber(byCode.get(METRIC.eps)?.raw),
    netProfitMargin: asNumber(byCode.get(METRIC.netProfitMargin)?.raw),
    freeFloatShares: asNumber(byCode.get(METRIC.freeFloatShares)?.raw),
    freeFloatPercent: asNumber(byCode.get(METRIC.freeFloatPercent)?.raw),
  };
}

export interface SarmaayaRatioSeries {
  bookValue: number | null;
  roe: number | null;
  roa: number | null;
  payoutRatio: number | null;
  roic: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
  /** `asOf` of the row the book value came from (`YYYY-MM-DD`), for the log. */
  bookValueAsOf: string | null;
  /** Which periodicity answered — `LTM` normally, `ANN` when TTM published no book value. */
  periodicity: 'LTM' | 'ANN' | null;
}

/** The source's own keys for the series we read. */
const SERIES = {
  bookValue: 'Book Value Per Share',
  roe: 'Return on Common Equity (%)',
  roa: 'Return on Average Assets (%)',
  payoutRatio: 'Dividend Payout Ratio',
  roic: 'Return on Average Invested Capital (%)',
  // Published as "Debt to Equity (%)"; converted to a ratio (÷100) by `parseSarmaayaRatioSeries`.
  debtToEquity: 'Debt to Equity (%)',
  currentRatio: 'Current Ratio (x)',
  revenueGrowth: 'Net Sales YoY Growth (%)',
  epsGrowth: 'EPS Basic YoY Growth (%)',
} as const;

/**
 * The newest value of one named series, or null.
 *
 * The series is published newest-first; `data[0]` is the current period. Values arrive as numbers
 * or as quoted strings depending on the metric, so every one goes through `asNumber`. A period the
 * source leaves empty is absent from `data` rather than zero — and the annual series does carry a
 * repeated stale-looking value in older rows, which is exactly why only the newest entry is taken.
 */
export function seriesLatest(payload: unknown, name: string): { value: number | null; asOf: string | null } {
  const response = (payload as { response?: unknown } | null)?.response;
  if (!response || typeof response !== 'object') return { value: null, asOf: null };
  const series = (response as Record<string, unknown>)[name];
  if (!series || typeof series !== 'object') return { value: null, asOf: null };
  const data = (series as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return { value: null, asOf: null };
  const head = data[0] as Record<string, unknown> | null;
  if (!head || typeof head !== 'object') return { value: null, asOf: null };
  const date = typeof head.date === 'string' ? head.date.slice(0, 10) : null;
  return { value: asNumber(head.value), asOf: date };
}

/** Book value per share, ROE, ROA and the six fundamental ratios out of one ratio-series response. */
export function parseSarmaayaRatioSeries(
  payload: unknown,
  periodicity: 'LTM' | 'ANN',
): SarmaayaRatioSeries {
  const book = seriesLatest(payload, SERIES.bookValue);
  return {
    bookValue: book.value,
    roe: seriesLatest(payload, SERIES.roe).value,
    roa: seriesLatest(payload, SERIES.roa).value,
    payoutRatio: seriesLatest(payload, SERIES.payoutRatio).value,
    roic: seriesLatest(payload, SERIES.roic).value,
    debtToEquity: pctToRatio(seriesLatest(payload, SERIES.debtToEquity).value),
    currentRatio: seriesLatest(payload, SERIES.currentRatio).value,
    revenueGrowth: seriesLatest(payload, SERIES.revenueGrowth).value,
    epsGrowth: seriesLatest(payload, SERIES.epsGrowth).value,
    bookValueAsOf: book.asOf,
    periodicity,
  };
}

/** Field-wise: keep what we have, take what the other periodicity adds. */
export function mergeRatioSeries(a: SarmaayaRatioSeries, b: SarmaayaRatioSeries): SarmaayaRatioSeries {
  return {
    bookValue: a.bookValue ?? b.bookValue,
    roe: a.roe ?? b.roe,
    roa: a.roa ?? b.roa,
    payoutRatio: a.payoutRatio ?? b.payoutRatio,
    roic: a.roic ?? b.roic,
    debtToEquity: a.debtToEquity ?? b.debtToEquity,
    currentRatio: a.currentRatio ?? b.currentRatio,
    revenueGrowth: a.revenueGrowth ?? b.revenueGrowth,
    epsGrowth: a.epsGrowth ?? b.epsGrowth,
    bookValueAsOf: a.bookValue !== null ? a.bookValueAsOf : b.bookValueAsOf,
    periodicity: a.bookValue !== null || a.roe !== null || a.roa !== null ? a.periodicity : b.periodicity,
  };
}

/**
 * Parse one income-statement response (the ANN or the LTM series) into line items keyed by period.
 *
 * The endpoint answers `{ response: { "<display name>": { metric, data: [ { value, year, … } ] } } }`
 * — one entry per statement line, `data` newest-first. A bank's set of lines is not an
 * industrial's, so the lines are returned in the source's own order and the UI renders whatever
 * rows exist.
 *
 * The two periodicities mean different things:
 *  - LTM: `data` is a run of quarterly trailing-twelve-month readings (newest first), every one a
 *    real number. The "TTM" column is `data[0]`.
 *  - ANN: `data` is the fiscal-year run (newest first). The newest year is a real JSON number; the
 *    annual series repeats a stale placeholder down its older rows, and it publishes that
 *    placeholder as a *quoted string* where the real readings are numbers. Only number-typed rows
 *    are taken, so a placeholder never reaches a column (the user accepted that older years will be
 *    mostly empty).
 */
export function parseSarmaayaIncomeStatement(
  payload: unknown,
  periodicity: 'LTM' | 'ANN',
): IncomeStatementDTO | null {
  const response = (payload as { response?: unknown } | null)?.response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const map = response as Record<string, unknown>;

  const periods: string[] = [];
  const lines: IncomeStatementLineDTO[] = [];

  for (const [name, raw] of Object.entries(map)) {
    if (!raw || typeof raw !== 'object') continue;
    const series = raw as { metric?: unknown; data?: unknown };
    if (!Array.isArray(series.data) || series.data.length === 0) continue;
    const metricCode = typeof series.metric === 'string' ? series.metric : '';
    const values: Record<string, number | null> = {};

    if (periodicity === 'LTM') {
      const head = series.data[0] as Record<string, unknown>;
      values['TTM'] = asNumber(head.value);
      if (!periods.includes('TTM')) periods.push('TTM');
    } else {
      for (const row of series.data as Record<string, unknown>[]) {
        // Real readings are JSON numbers; the stale placeholder is a quoted string. Skip strings.
        if (typeof row.value !== 'number') continue;
        const year = typeof row.year === 'number' ? String(row.year) : null;
        if (year === null) continue;
        if (!periods.includes(year)) periods.push(year);
        values[year] = asNumber(row.value);
      }
    }

    // Push every line the source publishes, even one with no real value for *this* periodicity —
    // e.g. "Net Interest Income" has only placeholder strings in ANN but a real TTM in LTM. Dropping
    // it here would let the merge re-append it out of statement order, so the row must keep its
    // place and let the merge fill its values from the other leg.
    lines.push({ metricCode, metricName: name, values });
  }

  if (lines.length === 0) return null;
  return { periods, lines };
}

/**
 * One income statement out of the LTM and ANN responses: the TTM column first, then the fiscal
 * years the annual series carried. Line items are unioned by metric code in the source's own
 * order, so a line the annual series omitted still keeps its TTM value and vice versa.
 */
export function mergeIncomeStatements(
  ltm: IncomeStatementDTO | null,
  ann: IncomeStatementDTO | null,
): IncomeStatementDTO | null {
  if (!ltm && !ann) return null;
  const periods: string[] = [];
  for (const src of [ltm, ann]) {
    if (!src) continue;
    for (const p of src.periods) if (!periods.includes(p)) periods.push(p);
  }

  const order: string[] = [];
  const byKey = new Map<string, IncomeStatementLineDTO>();
  for (const src of [ann, ltm]) {
    if (!src) continue;
    for (const line of src.lines) {
      const key = line.metricCode || line.metricName;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...line, values: { ...line.values } });
        order.push(key);
      } else {
        Object.assign(existing.values, line.values);
      }
    }
  }

  return { periods, lines: order.map((k) => byKey.get(k)!) };
}

/** A dividend row has to look like a date before it can key one; the source prints `0000-00-00`. */
function validDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  // Midnight UTC of the announced day: the source publishes a date, not an instant, and this is
  // the same value `new Date('2026-08-10')` yields. Rendered in Karachi (UTC+5) it is 05:00 on the
  // announced day, so the calendar day a reader sees is the one the source stated.
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // `0000-00-00` fails the parse above; the bound also drops a source-side `1970-01-01` placeholder.
  if (parsed.getUTCFullYear() < 1990) return null;
  return parsed.toISOString();
}

/** Bound on what one sync will write per symbol; the source keeps ~7 real rows. */
const MAX_DIVIDENDS = 40;

/**
 * The payout history as dividend rows.
 *
 * Only `payoutType: "dividend"` rows are taken — the same response also carries placeholder rows
 * (`payoutType: "type"`, `announcementDate: "0000-00-00"`, `dividendPerShare: 0`) that are not
 * payouts of anything, and a row without a usable announcement date cannot key the dividends table
 * at all (`(stock_id, announcement_date)` is unique, and the persist skips a dateless row anyway).
 *
 * No ex-date is invented: this source publishes the **announcement** date, and the issue settled
 * that the date row carries that. `bookClosure`/`paymentDate` stay null — nothing here states them.
 */
export function parseSarmaayaDividends(payload: unknown): DividendDTO[] {
  const history = (payload as { response?: { payoutHistory?: unknown } } | null)?.response?.payoutHistory;
  if (!Array.isArray(history)) return [];

  const byDate = new Map<string, DividendDTO>();
  for (const raw of history as Record<string, unknown>[]) {
    if (raw.payoutType !== 'dividend') continue;
    const announcementDate = validDate(raw.announcementDate);
    if (!announcementDate) continue;
    const amount = asNumber(raw.dividendPerShare);
    // A payout row with no per-share amount states no dividend we can serve; a zero here is the
    // source's placeholder, not a company that paid nothing.
    if (amount === null || amount <= 0) continue;
    if (byDate.has(announcementDate)) continue;
    byDate.set(announcementDate, {
      announcementDate,
      bookClosure: null,
      paymentDate: null,
      dividend: amount,
    });
  }

  return [...byDate.values()]
    .sort((a, b) => (b.announcementDate ?? '').localeCompare(a.announcementDate ?? ''))
    .slice(0, MAX_DIVIDENDS);
}

/** One JSON request, with a timeout and an honest User-Agent. */
async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': SCRAPER_USER_AGENT,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`http=${res.status}`) as Error & { httpStatus?: number };
    // A 404 is the source answering about a symbol it does not carry — reported per leg, never a
    // transport failure and never a reason to trip the breaker.
    err.httpStatus = res.status;
    throw err;
  }
  return JSON.parse(await res.text()) as unknown;
}

interface Leg {
  ok: boolean;
  error?: string;
  transport: boolean;
}

function failure(err: unknown): Leg {
  const status = (err as { httpStatus?: number } | null)?.httpStatus;
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message, transport: status === undefined };
}

/**
 * Scraper for the sarmaaya JSON API: ratios, book value per share and dividends.
 *
 * Registered alongside the page scraper rather than folded into it, for the same reason the quote
 * poll has its own plain-HTTP legs: a Chromium pass that dies takes its whole provider down with
 * it, and the ratios are exactly the data that must survive that — the page's own ratio block is
 * the one that has been returning null for the whole board.
 */
export class SarmaayaFundamentalsScraper implements IStockScraper {
  readonly source = SARMAYA_FUNDAMENTALS_SOURCE;

  async scrape(symbol: string): Promise<ScrapeResult> {
    const sym = symbol.toUpperCase();
    const log = childLogger({ symbol: sym, op: 'scrape', source: this.source });
    // Same discipline as every other source: do not ask one that is already refusing us. The
    // breaker throws before a request leaves the process.
    sourceBreaker.assertAvailable(this.source);

    let details: SarmaayaDetails = {
      isin: null, peRatio: null, pbRatio: null, dividendYield: null, eps: null,
      netProfitMargin: null, freeFloatShares: null, freeFloatPercent: null,
    };
    let detailsLeg: Leg = { ok: true, transport: false };
    let seriesLeg: Leg = { ok: true, transport: false };
    let dividendsLeg: Leg = { ok: true, transport: false };
    let incomeLeg: Leg = { ok: true, transport: false };
    let series: SarmaayaRatioSeries = {
      bookValue: null, roe: null, roa: null, bookValueAsOf: null, periodicity: null,
      payoutRatio: null, roic: null, debtToEquity: null, currentRatio: null,
      revenueGrowth: null, epsGrowth: null,
    };
    let dividends: DividendDTO[] = [];
    let incomeStatement: IncomeStatementDTO | null = null;

    try {
      // The metric table first: it is one small request and it carries the ISIN the ratio series
      // is addressed by, so no separate company lookup is spent per symbol.
      details = parseSarmaayaDetails(await fetchJson(sarmaayaDetailsUrl(sym), { method: 'POST', body: '{}' }));
    } catch (err) {
      detailsLeg = failure(err);
    }

    const isin = details.isin;
    const [seriesResult, dividendsResult, incomeResult] = await Promise.allSettled([
      isin
        ? (async (): Promise<SarmaayaRatioSeries> => {
            const ttm = parseSarmaayaRatioSeries(await fetchJson(sarmaayaRatioSeriesUrl(isin, 'LTM')), 'LTM');
            // TTM is the current column; the annual series is only fetched when TTM published no
            // book value, so the common case costs one request.
            if (ttm.bookValue !== null) return ttm;
            const annual = parseSarmaayaRatioSeries(await fetchJson(sarmaayaRatioSeriesUrl(isin, 'ANN')), 'ANN');
            return mergeRatioSeries(ttm, annual);
          })()
        : Promise.reject(new Error('no isin in the metric table')),
      fetchJson(sarmaayaDividendsUrl(sym)).then(parseSarmaayaDividends),
      // The income statement needs both periodicities — LTM for the TTM column, ANN for the fiscal
      // years — so this leg costs two requests and is what fills the Financials section.
      isin
        ? (async (): Promise<IncomeStatementDTO | null> => {
            const ltm = parseSarmaayaIncomeStatement(
              await fetchJson(sarmaayaIncomeStatementUrl(isin, 'LTM')), 'LTM');
            const ann = parseSarmaayaIncomeStatement(
              await fetchJson(sarmaayaIncomeStatementUrl(isin, 'ANN')), 'ANN');
            return mergeIncomeStatements(ltm, ann);
          })()
        : Promise.reject(new Error('no isin in the metric table')),
    ]);

    if (seriesResult.status === 'fulfilled') series = seriesResult.value;
    else seriesLeg = failure(seriesResult.reason);

    if (dividendsResult.status === 'fulfilled') dividends = dividendsResult.value;
    else dividendsLeg = failure(dividendsResult.reason);

    if (incomeResult.status === 'fulfilled') incomeStatement = incomeResult.value;
    else incomeLeg = failure(incomeResult.reason);

    const legs: Array<[string, Leg]> = [
      ['details', detailsLeg],
      ['ratio-series', seriesLeg],
      ['dividends', dividendsLeg],
      ['income-statement', incomeLeg],
    ];
    const failed = legs.filter(([, l]) => !l.ok);
    for (const [name, leg] of failed) log.warn('sarmaaya-fundamentals.leg_failed', { leg: name, error: leg.error });

    if (failed.length === legs.length) {
      const error = new SiteUnavailableError(this.source, {
        symbol: sym,
        first: failed[0]?.[1].error,
      });
      sourceBreaker.recordFailure(this.source, error.message);
      throw error;
    }
    // A leg that reached the host and was told "no" is an answer, not an outage: only a transport
    // failure counts, and only when the run produced nothing at all.
    const transportFailures = failed.filter(([, l]) => l.transport);
    const producedSomething = details.peRatio !== null || details.pbRatio !== null
      || details.dividendYield !== null || details.eps !== null
      || details.netProfitMargin !== null || details.freeFloatShares !== null
      || series.bookValue !== null || series.roe !== null || series.roic !== null
      || dividends.length > 0 || incomeStatement !== null;
    if (transportFailures.length > 0 && !producedSomething) {
      sourceBreaker.recordFailure(this.source, transportFailures[0]?.[1].error ?? 'transport failure');
    } else {
      sourceBreaker.recordSuccess(this.source);
    }

    const ratios: RatioDTO = {
      peRatio: details.peRatio,
      pbRatio: details.pbRatio,
      roe: series.roe,
      roa: series.roa,
      dividendYield: details.dividendYield,
      bookValue: series.bookValue,
      // Earnings per share: read from the same metric table as the ratios above (`FF_EPS`), which is
      // the figure the source's own stock page prints. Its P/E and EPS are not each other's inverse
      // (195.27 / 12.48 = 15.64 against a published 15.94), so the published one is read and a
      // genuinely absent one stays null -- the app's dash, never a figure derived from a ratio.
      eps: details.eps,
      // Beta is computed from our own history against the index (#79, criterion 7), never borrowed
      // from this payload — it carries no beta at all.
      beta: null,
      // Fundamentals (#131): the details payload carries the margin and the free-float pair, the
      // ratio series carries the six operating ratios. A source that publishes none (a bank, an ETF,
      // a preference share) stays null and renders as the dash.
      netProfitMargin: details.netProfitMargin,
      freeFloatShares: details.freeFloatShares,
      freeFloatPercent: details.freeFloatPercent,
      // DPS is the newest announced per-share dividend, not the annualised sum: the dividends
      // endpoint is the universal source for it (the ratio series's `Dividends Per Share` is absent
      // for banks), and a symbol with no dividend on record stays null.
      dps: dividends[0]?.dividend ?? null,
      payoutRatio: series.payoutRatio,
      roic: series.roic,
      debtToEquity: series.debtToEquity,
      currentRatio: series.currentRatio,
      revenueGrowth: series.revenueGrowth,
      epsGrowth: series.epsGrowth,
    };

    log.info('sarmaaya-fundamentals.parsed', {
      peRatio: ratios.peRatio,
      pbRatio: ratios.pbRatio,
      dividendYield: ratios.dividendYield,
      bookValue: ratios.bookValue,
      eps: ratios.eps,
      bookValuePeriod: series.periodicity,
      bookValueAsOf: series.bookValueAsOf,
      dividends: dividends.length,
      newestDividend: dividends[0]?.announcementDate ?? null,
      incomeStatementLines: incomeStatement?.lines.length ?? 0,
      legsFailed: failed.map(([name]) => name),
    });

    return {
      symbol: sym,
      // Company name and sector belong to the page scraper; this leg only adds the numbers. An
      // absent value here must not blank one another provider supplied.
      companyName: null,
      sector: null,
      price: null,
      dividends,
      financials: [],
      ratios,
      incomeStatement,
    };
  }
}
