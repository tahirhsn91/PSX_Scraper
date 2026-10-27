import { prisma } from '../database/prisma';
import { NotFoundError, ValidationError } from '../types/errors';

/**
 * ROI calculator — single holding, monthly DCA vs lump sum, and a 4-way comparison.
 *
 * Three rules shape this file:
 *
 * 1. **Every number comes from a stored row.** Prices are the session close we hold, index levels are
 *    the stored `index_values` close, dividends are stored rows. Nothing is modelled, interpolated or
 *    fetched at request time, so a figure can always be traced back to a date in the database.
 *
 * 2. **Money is integer paisa.** Prices are converted once (`Math.round(x * 100)`) and every
 *    multiplication, fee and subtraction happens on integers; only the response divides by 100.
 *    Floating-point rupee arithmetic on a 10-year series drifts by whole rupees at the tail, which is
 *    exactly the kind of "close enough" this app does not do. Fees round to the nearest paisa at the
 *    point they are charged, and quantities are floored, so cash is never spent twice.
 *
 * 3. **What we do not know is said out loud.** Splits and bonus issues are not adjusted in stored
 *    prices (`corporate_actions` is empty), so a window containing one is detected, reported in
 *    `warnings`, and its annualised figure is withheld rather than printed as if it meant something.
 *    Dividends are dated by their stored **announcement** date because no ex-date is published in our
 *    data; that approximation is named in `assumptions` and is never presented as an ex-date.
 */

export type RoiMode = 'single' | 'dca' | 'compare';

export interface RoiInput {
  mode: RoiMode;
  symbols: string[];
  /** ISO date the money goes in (single/compare) or the first month (DCA). */
  start: string;
  /** ISO date the position is sold; defaults to the latest completed session. */
  end?: string;
  /** Lump sum, or the monthly contribution in DCA mode. */
  amount: number;
  /** DCA only: day of month to invest on; resolved forward to the next session. */
  dayOfMonth?: number;
  feePct: number;
  feeFlat: number;
  divTaxPct: number;
  cgtPct: number;
}

export interface RoiWarning {
  code:
    | 'CORPORATE_ACTION_SUSPECTED'
    | 'ZERO_VOLUME_SESSION'
    | 'STALE_CLOSE'
    | 'DIVIDEND_TIMING_APPROXIMATED'
    | 'SHORT_HOLDING'
    | 'BENCHMARK_LIMITED'
    | 'SURVIVORSHIP';
  message: string;
  date?: string;
  symbol?: string;
}

export interface RoiPoint {
  date: string;
  value: number;
}

export interface RoiHolding {
  symbol: string;
  name: string | null;
  buy: { requested: string; session: string; price: number; movedFromRequest: boolean };
  sell: { requested: string; session: string; price: number; movedFromRequest: boolean };
  sessions: number;
  quantity: number;
  invested: number;
  buyFees: number;
  leftover: number;
  dividends: { count: number; gross: number; tax: number; net: number; items: { date: string; perShare: number }[] };
  proceeds: { gross: number; sellFees: number; tax: number; net: number };
  profit: number;
  returnPct: number;
  /** Annualised (XIRR) percent, or null when the holding is under a year or cannot be solved. */
  annualisedPct: number | null;
  holdingDays: number;
  maxDrawdownPct: number;
  series: RoiPoint[];
}

export interface RoiContribution {
  date: string;
  amount: number;
  price: number;
  quantity: number;
  fees: number;
}

export interface RoiDca {
  symbol: string;
  name: string | null;
  contributions: RoiContribution[];
  months: number;
  totalInvested: number;
  leftover: number;
  quantity: number;
  averageCost: number;
  sell: { requested: string; session: string; price: number };
  terminalValue: number;
  dividends: { count: number; gross: number; tax: number; net: number };
  profit: number;
  returnPct: number;
  annualisedPct: number | null;
  holdingDays: number;
  maxDrawdownPct: number;
  lumpSum: { returnPct: number; annualisedPct: number | null; terminalValue: number };
  benchmark: RoiRow | null;
  series: RoiPoint[];
}

export interface RoiRow {
  symbol: string;
  name: string | null;
  returnPct: number;
  annualisedPct: number | null;
  maxDrawdownPct: number | null;
  terminalValue: number | null;
  note?: string;
}

export interface RoiResult {
  meta: {
    mode: RoiMode;
    latestSession: string;
    window: { start: string; end: string; sessions: number };
    assumptions: string[];
    warnings: RoiWarning[];
  };
  holding?: RoiHolding;
  dca?: RoiDca;
  compare?: { start: string; end: string; rows: RoiRow[]; excluded: { symbol: string; reason: string }[] };
  benchmark: RoiRow | null;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 366 * 15;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const paisa = (rs: number) => Math.round(rs * 100);
const rupees = (p: number) => Math.round(p) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface PriceRow {
  symbol: string;
  name: string | null;
  d: string;
  close: number;
  volume: number | null;
}

interface Series {
  symbol: string;
  name: string | null;
  /** date → close, one entry per session, oldest first insertion order preserved by Map. */
  closes: Map<string, number>;
  volumes: Map<string, number | null>;
}

/** The latest completed session the market has actually stored. */
export async function latestSession(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ d: string }[]>(`
    SELECT max(iv.trade_date)::date::text AS d
    FROM index_values iv
    JOIN market_indices mi ON mi.id = iv.index_id
    WHERE mi.symbol = 'KSE100'
  `);
  const fromIndex = rows[0]?.d ?? null;
  if (fromIndex) {
    const age = Math.floor((Date.now() - new Date(`${fromIndex}T00:00:00Z`).getTime()) / DAY_MS);
    // The index sync lags the board by a session now and then; a gap longer than ten days means the
    // series itself is stale and the board's newest weekday is the better answer.
    if (age <= 10) return fromIndex;
  }
  const fallback = await prisma.$queryRawUnsafe<{ d: string }[]>(`
    SELECT max(last_trade_date)::date::text AS d FROM stock_prices
  `);
  if (!fallback[0]?.d) throw new NotFoundError('No stored sessions');
  return fallback[0].d;
}

async function loadSeries(symbols: string[], from: string, to: string): Promise<Map<string, Series>> {
  const rows = await prisma.$queryRawUnsafe<PriceRow[]>(
    `
    SELECT s.symbol, s.company_name AS name, per_day.d::text AS d,
           per_day.close::float8 AS close, per_day.volume::float8 AS volume
    FROM stocks s
    JOIN LATERAL (
      SELECT d, close, volume FROM (
        -- One close per session: several syncs may write the same date (an intraday poll and the
        -- closing pass), and the last write of the day is the reading the app shows everywhere else.
        SELECT DISTINCT ON (last_trade_date::date)
          last_trade_date::date AS d, close, volume
        FROM stock_prices
        WHERE stock_id = s.id AND close IS NOT NULL AND close > 0
          AND last_trade_date::date BETWEEN $2::date AND $3::date
        ORDER BY last_trade_date::date DESC, last_trade_date DESC
      ) per_day_inner
      ORDER BY d ASC
    ) per_day ON TRUE
    WHERE s.symbol = ANY($1)
    ORDER BY s.symbol, per_day.d ASC
    `,
    symbols,
    from,
    to,
  );

  const out = new Map<string, Series>();
  for (const r of rows) {
    let s = out.get(r.symbol);
    if (!s) {
      s = { symbol: r.symbol, name: r.name, closes: new Map(), volumes: new Map() };
      out.set(r.symbol, s);
    }
    s.closes.set(r.d, Number(r.close));
    s.volumes.set(r.d, r.volume == null ? null : Number(r.volume));
  }
  return out;
}

interface IndexRow {
  d: string;
  value: number;
}

async function loadIndex(symbol: string, from: string, to: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRawUnsafe<IndexRow[]>(
    `
    SELECT iv.trade_date::date::text AS d, iv.value::float8 AS value
    FROM index_values iv
    JOIN market_indices mi ON mi.id = iv.index_id
    WHERE mi.symbol = $1 AND iv.trade_date::date BETWEEN $2::date AND $3::date
    ORDER BY iv.trade_date ASC
    `,
    symbol,
    from,
    to,
  );
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.d, Number(r.value));
  return m;
}

interface DividendRow {
  symbol: string;
  d: string;
  amount: number;
}

async function loadDividends(symbols: string[], from: string, to: string): Promise<Map<string, DividendRow[]>> {
  const rows = await prisma.$queryRawUnsafe<DividendRow[]>(
    `
    SELECT s.symbol, d.announcement_date::date::text AS d, d.dividend::float8 AS amount
    FROM dividends d
    JOIN stocks s ON s.id = d.stock_id
    WHERE s.symbol = ANY($1) AND d.announcement_date IS NOT NULL
      AND d.announcement_date::date > $2::date AND d.announcement_date::date <= $3::date
    ORDER BY s.symbol, d.announcement_date ASC
    `,
    symbols,
    from,
    to,
  );
  const m = new Map<string, DividendRow[]>();
  for (const r of rows) {
    const list = m.get(r.symbol) ?? [];
    list.push({ ...r, amount: Number(r.amount) });
    m.set(r.symbol, list);
  }
  return m;
}

/** The first session on or after `date`, or null when the series ends before it. */
export function sessionOnOrAfter(dates: string[], date: string): string | null {
  for (const d of dates) if (d >= date) return d;
  return null;
}

/** The last session on or before `date`, or null when the series starts after it. */
export function sessionOnOrBefore(dates: string[], date: string): string | null {
  let found: string | null = null;
  for (const d of dates) {
    if (d <= date) found = d;
    else break;
  }
  return found;
}

/**
 * A split or bonus shows up as a price step that no market move explains.
 *
 * The test is deliberately conservative: a step of 25% or more, and only when the price lands on a
 * simple fraction of the previous close (halving, a third, a tenth, or the reverse). A stock that
 * merely fell 30% does not land on 1/2.000 of its previous close, so it does not trip the warning.
 */
export function suspectedAction(prev: number, close: number): number | null {
  if (!(prev > 0) || !(close > 0)) return null;
  const ratio = prev / close;
  const fractions = [2, 3, 4, 5, 6, 8, 10, 12.5, 20];
  for (const f of fractions) {
    if (Math.abs(ratio / f - 1) <= 0.03) return f;
  }
  for (const f of fractions) {
    if (Math.abs(ratio * f - 1) <= 0.03) return 1 / f;
  }
  return null;
}

/**
 * Simple annualisation of a start/end level pair, actual/365.
 *
 * Used only for the index benchmark, which has no cash flows of its own: a level ratio is the whole
 * of its return. Null under a year, matching the holding's rule.
 */
export function annualiseLevels(startLevel: number, endLevel: number, days: number): number | null {
  if (!(startLevel > 0) || !(endLevel > 0) || days < 365) return null;
  return round2((Math.pow(endLevel / startLevel, 365 / days) - 1) * 100);
}

/** Internal rate of return on dated cash flows, actual/365, solved by bisection. */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;
  const t0 = new Date(`${flows[0]?.date}T00:00:00Z`).getTime();
  const years = flows.map((f) => (new Date(`${f.date}T00:00:00Z`).getTime() - t0) / DAY_MS / 365);

  const npv = (rate: number): number =>
    flows.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, years[i] ?? 0), 0);

  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (flo === 0) return lo * 100;
  if (fhi === 0) return hi * 100;
  if (flo * fhi > 0) return null; // no sign change: no real solution in the range

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 0.005) return mid * 100;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return ((lo + hi) / 2) * 100;
}

/** Deepest peak-to-trough fall of a value series, as a positive percent. */
export function maxDrawdown(values: number[]): number {
  let peak = values[0] ?? 0;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
  }
  return round2(worst * 100);
}

interface Lot {
  quantity: number;
  invested: number; // paisa actually spent, including the fee
  fees: number;
  leftover: number;
  deployed: number;
}

/** Buy whole shares with a cash amount: fee percent on the traded value plus a flat charge. */
export function buyLot(cashP: number, priceRs: number, feePct: number, feeFlatRs: number): Lot {
  const priceP = paisa(priceRs);
  const flatP = paisa(feeFlatRs);
  const bps = Math.round(feePct * 100); // 0.15% → 15 basis points
  const perShare = priceP * (1 + bps / 10_000);
  const qty = Math.max(0, Math.floor((cashP - flatP) / perShare));
  if (qty === 0) return { quantity: 0, invested: 0, fees: 0, leftover: cashP, deployed: 0 };
  const gross = qty * priceP;
  const fees = Math.round((gross * bps) / 10_000) + flatP;
  const invested = gross + fees;
  return { quantity: qty, invested, fees, leftover: cashP - invested, deployed: gross };
}

interface Month {
  year: number;
  month: number; // 1-12
}

function monthKey(d: string): Month {
  return { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) };
}

function sameMonth(a: Month, b: Month): boolean {
  return a.year === b.year && a.month === b.month;
}

function endOfMonth(m: Month): string {
  const d = new Date(Date.UTC(m.year, m.month, 0));
  return iso(d); // day 0 of the next month is the last day of this one
}

/**
 * Monthly contribution dates: the requested day, moved forward to the next session, never past month
 * end. The final month is truncated at the sell session so the plan cannot buy after the sale.
 */
export function dcaSchedule(dates: string[], start: string, end: string, day: number): string[] {
  if (dates.length === 0) return [];
  const out: string[] = [];
  let cursor: Month = monthKey(start);
  const last: Month = monthKey(end);
  const guard = 12 * 40;

  for (let i = 0; i < guard; i++) {
    // Day > 28 has to use the real month length, so ask the calendar rather than clamping to 28.
    const targetReal = `${cursor.year}-${String(cursor.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const monthEnd = endOfMonth(cursor);
    const want = targetReal <= monthEnd ? targetReal : monthEnd;
    const from = i === 0 && want < start ? start : want;
    let session = sessionOnOrAfter(dates, from);
    // A target that falls on a weekend must not spill into the next month: "invest on the 31st"
    // when the 31st is a Sunday means the last session of *that* month, or March would be skipped
    // and April charged twice.
    if (session && session > monthEnd) session = sessionOnOrBefore(dates, monthEnd);
    if (session && session <= end) out.push(session);

    if (sameMonth(cursor, last)) break;
    cursor = cursor.month === 12 ? { year: cursor.year + 1, month: 1 } : { year: cursor.year, month: cursor.month + 1 };
  }
  return [...new Set(out)];
}

interface SimInput {
  dates: string[];
  closes: Map<string, number>;
  volumes?: Map<string, number | null>;
  contributions: { date: string; cashP: number }[];
  sellDate: string;
  feePct: number;
  feeFlatRs: number;
  dividends: { date: string; perShare: number }[];
  divTaxPct: number;
  cgtPct: number;
}

interface SimOutput {
  quantity: number;
  invested: number; // paisa
  fees: number;
  leftover: number;
  dividends: { count: number; gross: number; tax: number; net: number; items: { date: string; perShare: number }[] };
  proceeds: { gross: number; fees: number; tax: number; net: number };
  profit: number;
  returnPct: number;
  annualisedPct: number | null;
  holdingDays: number;
  series: RoiPoint[];
  warnings: RoiWarning[];
  flows: { date: string; amount: number }[];
  lots: { date: string; price: number; quantity: number; fees: number }[];
}

function simulate(input: SimInput): SimOutput {
  const { dates, closes, contributions, sellDate, feePct, feeFlatRs, dividends, divTaxPct, cgtPct } = input;
  const warnings: RoiWarning[] = [];

  let quantity = 0;
  let leftover = 0;
  let invested = 0;
  let fees = 0;
  let divGross = 0;
  let divTax = 0;
  let divCount = 0;
  const divItems: { date: string; perShare: number }[] = [];
  const flows: { date: string; amount: number }[] = [];
  const points: RoiPoint[] = [];
  const lots: { date: string; price: number; quantity: number; fees: number }[] = [];

  type Event = { date: string; kind: 'buy'; cashP: number } | { date: string; kind: 'div'; perShare: number };
  const events: Event[] = [
    ...contributions.map((c) => ({ date: c.date, kind: 'buy' as const, cashP: c.cashP })),
    ...dividends.map((d) => ({ date: d.date, kind: 'div' as const, perShare: d.perShare })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'buy' ? -1 : 1));

  const firstBuy = contributions[0]?.date ?? sellDate;
  const windowDates = dates.filter((d) => d >= firstBuy && d <= sellDate);

  let ei = 0;
  for (const d of windowDates) {
    while (ei < events.length && events[ei]!.date <= d) {
      const ev = events[ei]!;
      if (ev.kind === 'buy') {
        const price = closes.get(d) ?? closes.get(ev.date);
        if (price && price > 0) {
          const lot = buyLot(ev.cashP + leftover, price, feePct, feeFlatRs);
          if (lot.quantity > 0) {
            quantity += lot.quantity;
            invested += lot.invested;
            fees += lot.fees;
            leftover = lot.leftover;
            lots.push({ date: d, price, quantity: lot.quantity, fees: lot.fees });
            flows.push({ date: d, amount: -lot.invested / 100 });
          } else {
            leftover = ev.cashP + leftover;
          }
        }
      } else if (quantity > 0) {
        // Dividend on shares held at this date, per the stored announcement-date approximation.
        const grossP = Math.round(quantity * ev.perShare * 100);
        const taxP = Math.round((grossP * Math.round(divTaxPct * 100)) / 10_000);
        divGross += grossP;
        divTax += taxP;
        divCount += 1;
        divItems.push({ date: ev.date, perShare: ev.perShare });
        flows.push({ date: ev.date, amount: (grossP - taxP) / 100 });
      }
      ei += 1;
    }
    const price = closes.get(d);
    if (price && quantity > 0) points.push({ date: d, value: rupees(quantity * paisa(price)) });
  }

  const sellClose = closes.get(sellDate);
  if (!sellClose) throw new ValidationError('No stored close on the sell session');
  const grossP = quantity * paisa(sellClose);
  const bps = Math.round(feePct * 100);
  const sellFeesP = Math.round((grossP * bps) / 10_000) + paisa(feeFlatRs);
  const gainP = grossP - sellFeesP - invested;
  const cgtP = gainP > 0 ? Math.round((gainP * Math.round(cgtPct * 100)) / 10_000) : 0;
  const netP = grossP - sellFeesP - cgtP;
  flows.push({ date: sellDate, amount: netP / 100 });

  // The final point is the sale itself, so the chart's last value is the money the reader gets.
  points.push({ date: sellDate, value: rupees(netP) });

  const profitP = netP + (divGross - divTax) - invested;
  const returnPct = invested > 0 ? round2((profitP / invested) * 100) : 0;
  const holdingDays = Math.max(
    0,
    Math.round((new Date(`${sellDate}T00:00:00Z`).getTime() - new Date(`${firstBuy}T00:00:00Z`).getTime()) / DAY_MS),
  );

  // A corporate action inside the window moves the price by an amount no market session explains.
  const seriesArr = [...closes.entries()].filter(([d]) => d >= firstBuy && d <= sellDate);
  for (let i = 1; i < seriesArr.length; i++) {
    const prev = seriesArr[i - 1]![1];
    const cur = seriesArr[i]![1];
    const factor = suspectedAction(prev, cur);
    if (factor) {
      warnings.push({
        code: 'CORPORATE_ACTION_SUSPECTED',
        date: seriesArr[i]![0],
        message: `Price stepped ${factor >= 1 ? `1:${factor}` : `${Math.round(1 / factor)}:1`} between sessions — a split or bonus issue. Stored prices are not adjusted and corporate_actions is empty, so this return is not comparable and is not annualised.`,
      });
      break;
    }
  }

  const annualisedPct =
    holdingDays >= 365 && warnings.every((w) => w.code !== 'CORPORATE_ACTION_SUSPECTED')
      ? xirr(flows)
      : null;

  return {
    quantity,
    invested,
    fees,
    leftover,
    dividends: { count: divCount, gross: divGross, tax: divTax, net: divGross - divTax, items: divItems },
    proceeds: { gross: grossP, fees: sellFeesP, tax: cgtP, net: netP },
    profit: profitP,
    returnPct,
    annualisedPct: annualisedPct == null ? null : round2(annualisedPct),
    holdingDays,
    series: points,
    warnings,
    flows,
    lots,
  };
}

/** Downsample a daily series so a ten-year chart is not a 2,600-point payload. */
function thin(points: RoiPoint[], max = 400): RoiPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (last && out[out.length - 1]?.date !== last.date) out.push(last);
  return out;
}

export const ASSUMPTIONS = [
  'Prices are the stored session close: no slippage, no intraday fill, no partial execution.',
  'Fees are your inputs, not official PSX or broker rates.',
  'Taxes default to zero and are applied to recorded dividends and to the capital gain at sale.',
  'Dividends are dated by the stored announcement date — PSX ex-dates are not in our data, so a sale that lands between announcement and ex-date may be credited a dividend it did not earn.',
  'Splits and bonus issues are not adjusted in stored prices while corporate_actions is empty.',
  'Only currently stored securities are included, so long-run results carry survivorship bias.',
  'Past performance is not a forecast and this is not investment advice.',
];

function baseWarnings(): RoiWarning[] {
  return [
    { code: 'DIVIDEND_TIMING_APPROXIMATED', message: 'Dividends use the announcement date as the entitlement marker.' },
    { code: 'SURVIVORSHIP', message: 'Only securities currently in the database are included.' },
  ];
}

function cleanSymbols(input: string[]): string[] {
  const out = [...new Set(input.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  for (const s of out) if (!/^[A-Z0-9]{1,20}$/.test(s)) throw new ValidationError(`Invalid symbol: ${s}`);
  return out;
}

/** Compute the whole request. */
export async function calculateRoi(input: RoiInput): Promise<RoiResult> {
  const latest = await latestSession();
  const symbols = cleanSymbols(input.symbols);
  if (symbols.length === 0) throw new ValidationError('At least one symbol is required');
  if (input.mode === 'compare' && (symbols.length < 2 || symbols.length > 4)) {
    throw new ValidationError('Compare needs between 2 and 4 symbols');
  }
  if (input.mode !== 'compare' && symbols.length !== 1) {
    throw new ValidationError('This mode takes exactly one symbol');
  }

  const end = input.end && input.end.length ? input.end : latest;
  if (input.start > end) throw new ValidationError('The start date is after the end date');
  const span = (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${input.start}T00:00:00Z`).getTime()) / DAY_MS;
  if (span > MAX_DAYS) throw new ValidationError('The window is longer than 15 years');

  // Two sessions before the start, so a start on a holiday can resolve backwards for the benchmark
  // and the chart has a prior close to compare against on day one.
  const from = iso(new Date(new Date(`${input.start}T00:00:00Z`).getTime() - 10 * DAY_MS));
  const series = await loadSeries(symbols, from, end);
  const dividends = await loadDividends(symbols, from, end);

  const missing = symbols.filter((s) => !series.has(s));
  if (missing.length && input.mode !== 'compare') {
    throw new NotFoundError(`No stored sessions for ${missing.join(', ')}`);
  }

  const warnings: RoiWarning[] = baseWarnings();
  const assumptions = [...ASSUMPTIONS];

  const evaluate = (sym: string, start: string) => {
    const s = series.get(sym)!;
    const dates = [...s.closes.keys()].filter((d) => d <= latest);
    const buySession = sessionOnOrAfter(dates, start);
    const sellSession = sessionOnOrBefore(dates, end);
    if (!buySession || !sellSession || buySession > sellSession) {
      return { excluded: 'no session in the requested window' as const };
    }
    return { s, dates, buySession, sellSession };
  };

  if (input.mode === 'single') {
    const sym = symbols[0]!;
    const ev = evaluate(sym, input.start);
    if ('excluded' in ev) throw new ValidationError(`No stored session for ${sym} inside the window`);

    const { s, dates, buySession, sellSession } = ev;
    const buyPrice = s.closes.get(buySession)!;
    const sellPrice = s.closes.get(sellSession)!;
    const divs = (dividends.get(sym) ?? []).filter((d) => d.d > buySession && d.d <= sellSession);

    const sim = simulate({
      dates,
      closes: s.closes,
      volumes: s.volumes,
      contributions: [{ date: buySession, cashP: paisa(input.amount) }],
      sellDate: sellSession,
      feePct: input.feePct,
      feeFlatRs: input.feeFlat,
      dividends: divs.map((d) => ({ date: d.d, perShare: d.amount })),
      divTaxPct: input.divTaxPct,
      cgtPct: input.cgtPct,
    });

    warnings.push(...sim.warnings);
    const buyVol = s.volumes.get(buySession);
    const sellVol = s.volumes.get(sellSession);
    if (buyVol === 0) warnings.push({ code: 'ZERO_VOLUME_SESSION', date: buySession, message: 'No shares changed hands on the buy session; the close is a carried price.' });
    if (sellVol === 0) warnings.push({ code: 'ZERO_VOLUME_SESSION', date: sellSession, message: 'No shares changed hands on the sell session; the close is a carried price.' });
    if (sim.holdingDays < 365) {
      warnings.push({ code: 'SHORT_HOLDING', message: `Held ${sim.holdingDays} days — an annualised rate over less than a year is not meaningful and is not shown.` });
    }

    const investedRs = rupees(sim.invested);
    const holding: RoiHolding = {
      symbol: sym,
      name: s.name,
      buy: { requested: input.start, session: buySession, price: buyPrice, movedFromRequest: buySession !== input.start },
      sell: { requested: end, session: sellSession, price: sellPrice, movedFromRequest: sellSession !== end },
      sessions: dates.filter((d) => d >= buySession && d <= sellSession).length,
      quantity: sim.quantity,
      invested: investedRs,
      buyFees: rupees(sim.fees),
      leftover: rupees(sim.leftover),
      dividends: {
        count: sim.dividends.count,
        gross: rupees(sim.dividends.gross),
        tax: rupees(sim.dividends.tax),
        net: rupees(sim.dividends.net),
        items: sim.dividends.items,
      },
      proceeds: {
        gross: rupees(sim.proceeds.gross),
        sellFees: rupees(sim.proceeds.fees),
        tax: rupees(sim.proceeds.tax),
        net: rupees(sim.proceeds.net),
      },
      profit: rupees(sim.profit),
      returnPct: sim.returnPct,
      annualisedPct: sim.annualisedPct,
      holdingDays: sim.holdingDays,
      maxDrawdownPct: maxDrawdown(sim.series.map((p) => p.value)),
      series: thin(sim.series),
    };

    // Benchmark: the same cash, in the KSE-100 (total return), over the same window.
    let benchmark: RoiRow | null = null;
    const idx = await loadIndex('KSE100', buySession, sellSession);
    if (idx.size > 1) {
      const idxDates = [...idx.keys()];
      const startLevel = idx.get(idxDates[0]!)!;
      const endLevel = idx.get(idxDates[idxDates.length - 1]!)!;
      const bReturn = round2(((endLevel - startLevel) / startLevel) * 100);
      benchmark = {
        symbol: 'KSE100',
        name: 'KSE-100 (total return)',
        returnPct: bReturn,
        annualisedPct: annualiseLevels(startLevel, endLevel, holding.holdingDays),
        maxDrawdownPct: maxDrawdown(idxDates.map((d) => idx.get(d)!)),
        terminalValue: round2(rupees(sim.invested) * (1 + bReturn / 100)),
        note: 'index level, dividends reinvested by the index',
      };
    } else {
      warnings.push({ code: 'BENCHMARK_LIMITED', message: 'The KSE-100 had too few stored sessions to build a benchmark for this window.' });
    }

    return {
      meta: {
        mode: 'single',
        latestSession: latest,
        window: { start: buySession, end: sellSession, sessions: holding.sessions },
        assumptions,
        warnings,
      },
      holding,
      benchmark,
    };
  }

  if (input.mode === 'dca') {
    const sym = symbols[0]!;
    const ev = evaluate(sym, input.start);
    if ('excluded' in ev) throw new ValidationError(`No stored session for ${sym} inside the window`);
    const { s, dates, sellSession } = ev;
    const day = input.dayOfMonth ?? 1;
    const schedule = dcaSchedule(dates, input.start, sellSession, day);
    if (schedule.length < 2) throw new ValidationError('The window is too short for a monthly plan');

    const divs = (dividends.get(sym) ?? []).filter((d) => d.d > schedule[0]! && d.d <= sellSession);
    const sim = simulate({
      dates,
      closes: s.closes,
      volumes: s.volumes,
      contributions: schedule.map((d) => ({ date: d, cashP: paisa(input.amount) })),
      sellDate: sellSession,
      feePct: input.feePct,
      feeFlatRs: input.feeFlat,
      dividends: divs.map((d) => ({ date: d.d, perShare: d.amount })),
      divTaxPct: input.divTaxPct,
      cgtPct: input.cgtPct,
    });
    warnings.push(...sim.warnings);
    if (sim.holdingDays < 365) {
      warnings.push({ code: 'SHORT_HOLDING', message: `Plan ran ${sim.holdingDays} days — no annualised figure under a year.` });
    }

    const contributions: RoiContribution[] = sim.lots.map((l) => ({
      date: l.date,
      amount: input.amount,
      price: l.price,
      quantity: l.quantity,
      fees: rupees(l.fees),
    }));

    // Lump sum: the same cash the plan actually deployed, in at the first session with the same fees.
    const firstDate = schedule[0]!;
    const firstPrice = s.closes.get(firstDate)!;
    const lump = simulate({
      dates,
      closes: s.closes,
      contributions: [{ date: firstDate, cashP: sim.invested }],
      sellDate: sellSession,
      feePct: input.feePct,
      feeFlatRs: input.feeFlat,
      dividends: divs.map((d) => ({ date: d.d, perShare: d.amount })),
      divTaxPct: input.divTaxPct,
      cgtPct: input.cgtPct,
    });

    let benchmark: RoiRow | null = null;
    const idx = await loadIndex('KSE100', firstDate, sellSession);
    if (idx.size > 1) {
      const idxSeries = new Map(idx);
      const idxDates = [...idxSeries.keys()];
      const b = simulate({
        dates: idxDates,
        closes: idxSeries,
        contributions: schedule.map((d) => ({ date: d, cashP: paisa(input.amount) })),
        sellDate: idxDates[idxDates.length - 1]!,
        feePct: 0,
        feeFlatRs: 0,
        dividends: [],
        divTaxPct: 0,
        cgtPct: 0,
      });
      benchmark = {
        symbol: 'KSE100',
        name: 'KSE-100 (total return)',
        returnPct: b.returnPct,
        annualisedPct: b.annualisedPct,
        maxDrawdownPct: maxDrawdown(b.series.map((p) => p.value)),
        terminalValue: rupees(b.proceeds.net),
        note: 'the same monthly cash flows into the index',
      };
    } else {
      warnings.push({ code: 'BENCHMARK_LIMITED', message: 'The KSE-100 had too few stored sessions to build a benchmark for this window.' });
    }

    const endPrice = s.closes.get(sellSession)!;
    const dca: RoiDca = {
      symbol: sym,
      name: s.name,
      contributions,
      months: contributions.length,
      totalInvested: rupees(sim.invested),
      leftover: rupees(sim.leftover),
      quantity: sim.quantity,
      averageCost: sim.quantity > 0 ? round2(rupees(sim.invested) / sim.quantity) : 0,
      sell: { requested: end, session: sellSession, price: endPrice },
      terminalValue: rupees(sim.proceeds.net),
      dividends: { count: sim.dividends.count, gross: rupees(sim.dividends.gross), tax: rupees(sim.dividends.tax), net: rupees(sim.dividends.net) },
      profit: rupees(sim.profit),
      returnPct: sim.returnPct,
      annualisedPct: sim.annualisedPct,
      holdingDays: sim.holdingDays,
      maxDrawdownPct: maxDrawdown(
        dates.filter((d) => d >= firstDate && d <= sellSession).map((d) => s.closes.get(d)!).filter((n) => n > 0),
      ),
      lumpSum: {
        returnPct: lump.returnPct,
        annualisedPct: lump.annualisedPct,
        terminalValue: rupees(lump.proceeds.net),
      },
      benchmark,
      series: thin(sim.series),
    };

    return {
      meta: {
        mode: 'dca',
        latestSession: latest,
        window: { start: firstDate, end: sellSession, sessions: dates.filter((d) => d >= firstDate && d <= sellSession).length },
        assumptions,
        warnings,
      },
      dca,
      benchmark,
    };
  }

  // compare
  const usable = symbols.filter((s) => series.has(s));
  const excluded = symbols
    .filter((s) => !series.has(s))
    .map((symbol) => ({ symbol, reason: 'not tracked, or no stored sessions in this window' }));

  const rows: RoiRow[] = [];
  const prepared: { sym: string; s: Series; dates: string[]; start: string; end: string }[] = [];
  for (const sym of usable) {
    const s = series.get(sym)!;
    const dates = [...s.closes.keys()].filter((d) => d <= latest);
    const start = sessionOnOrAfter(dates, input.start);
    const finish = sessionOnOrBefore(dates, end);
    if (!start || !finish || start > finish) {
      excluded.push({ symbol: sym, reason: 'no overlapping history in this window' });
      continue;
    }
    prepared.push({ sym, s, dates, start, end: finish });
  }

  if (prepared.length < 2) {
    throw new ValidationError('Fewer than two symbols have history in this window');
  }

  const commonStart = prepared.map((p) => p.start).sort().at(-1)!;
  const commonEnd = prepared.map((p) => p.end).sort()[0]!;
  if (commonStart >= commonEnd) throw new ValidationError('The symbols do not overlap in this window');

  const overlapSessions = prepared[0]!.dates.filter((d) => d >= commonStart && d <= commonEnd).length;
  if (overlapSessions < 30) {
    throw new ValidationError(`Only ${overlapSessions} sessions overlap between these symbols; at least 30 are needed`);
  }

  for (const p of prepared) {
    const divs = (dividends.get(p.sym) ?? []).filter((d) => d.d > commonStart && d.d <= commonEnd);
    const sim = simulate({
      dates: p.dates,
      closes: p.s.closes,
      contributions: [{ date: commonStart, cashP: paisa(input.amount) }],
      sellDate: commonEnd,
      feePct: input.feePct,
      feeFlatRs: input.feeFlat,
      dividends: divs.map((d) => ({ date: d.d, perShare: d.amount })),
      divTaxPct: input.divTaxPct,
      cgtPct: input.cgtPct,
    });
    rows.push({
      symbol: p.sym,
      name: p.s.name,
      returnPct: sim.returnPct,
      annualisedPct: sim.annualisedPct,
      maxDrawdownPct: maxDrawdown(sim.series.map((x) => x.value)),
      terminalValue: rupees(sim.proceeds.net),
    });
  }

  rows.sort((a, b) => b.returnPct - a.returnPct);

  let benchmark: RoiRow | null = null;
  const idx = await loadIndex('KSE100', commonStart, commonEnd);
  if (idx.size > 1) {
    const idxDates = [...idx.keys()];
    const startLevel = idx.get(idxDates[0]!)!;
    const endLevel = idx.get(idxDates[idxDates.length - 1]!)!;
    const benchDays = Math.round(
      (new Date(`${commonEnd}T00:00:00Z`).getTime() - new Date(`${commonStart}T00:00:00Z`).getTime()) / DAY_MS,
    );
    benchmark = {
      symbol: 'KSE100',
      name: 'KSE-100 (total return)',
      returnPct: round2(((endLevel - startLevel) / startLevel) * 100),
      annualisedPct: annualiseLevels(startLevel, endLevel, benchDays),
      maxDrawdownPct: maxDrawdown(idxDates.map((d) => idx.get(d)!)),
      terminalValue: round2(input.amount * (endLevel / startLevel)),
      note: 'index level, dividends reinvested by the index',
    };
  } else {
    warnings.push({ code: 'BENCHMARK_LIMITED', message: 'The KSE-100 had too few stored sessions to build a benchmark for this window.' });
  }

  return {
    meta: {
      mode: 'compare',
      latestSession: latest,
      window: { start: commonStart, end: commonEnd, sessions: overlapSessions },
      assumptions,
      warnings,
    },
    compare: { start: commonStart, end: commonEnd, rows, excluded },
    benchmark,
  };
}
