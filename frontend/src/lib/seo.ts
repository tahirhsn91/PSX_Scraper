import { trendOf } from './format';

/** The brand shown in every stock page title. */
const BRAND = 'My Portfolio 365';

/** Meta title char budget (spec: 50–60 characters). */
const TITLE_MAX = 60;
/** Meta description char budget (spec: 150–160 characters). */
const DESCRIPTION_MAX = 160;

/** A price for the meta tags: at most two decimals, trailing zeros dropped (`762.87`, `755`). */
function formatPrice(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * `POL - 762.87 | Pakistan Oilfield Limited | My Portfolio 365` — kept to 60 characters by
 * budgeting the company name (the only unbounded part).
 */
export function stockMetaTitle(
  symbol: string,
  price: number | null | undefined,
  companyName: string | null | undefined,
): string {
  const p = formatPrice(price);
  const head = `${symbol}${p ? ` - ${p}` : ''}`;
  const brand = ` | ${BRAND}`;
  const separator = ' | ';
  const company = (companyName ?? '').trim();
  const budget = TITLE_MAX - head.length - separator.length - brand.length;
  const companyShown = budget >= 2 ? truncate(company, budget) : '';
  return companyShown ? `${head}${separator}${companyShown}${brand}` : `${head}${brand}`;
}

/** `up 1.16%`, `down 2.03%`, or `unchanged` — null when the change is not reported. */
function trendClause(changePercent: number | null | undefined): string | null {
  const t = trendOf(changePercent);
  if (t === null) return null;
  if (t === 'flat') return 'unchanged';
  const abs = Math.abs(changePercent as number).toFixed(2);
  return `${t === 'up' ? 'up' : 'down'} ${abs}%`;
}

/**
 * `POL share price today is PKR 762.87 on PSX, up 1.16%. View POL stock price, trading volume,
 * daily high of PKR 763.5 and low of PKR 755.` — kept to 160 characters.
 */
export function stockMetaDescription(
  symbol: string,
  price: number | null | undefined,
  changePercent: number | null | undefined,
  high: number | null | undefined,
  low: number | null | undefined,
): string {
  const p = formatPrice(price);
  const clause = trendClause(changePercent);
  const lead =
    `${symbol} share price today is PKR ${p ?? '—'} on PSX${clause ? `, ${clause}` : ''}. ` +
    `View ${symbol} stock price, trading volume`;
  const hi = formatPrice(high);
  const lo = formatPrice(low);
  const range = hi && lo ? `, daily high of PKR ${hi} and low of PKR ${lo}` : '';
  return truncate(`${lead}${range}.`, DESCRIPTION_MAX);
}

/** A signed percentage for an index return: `-1.85%`, `+2.34%`. Null when there is no figure. */
function formatReturn(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** A market cap in the exchange's compact units: `4.69T`, `651.14B`. Null when there is no figure. */
function formatMarketCapShort(rupees: number | null | undefined): string | null {
  if (rupees == null || !Number.isFinite(rupees) || rupees <= 0) return null;
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
  ];
  for (const [size, suffix] of units) {
    if (rupees >= size) return `${(rupees / size).toFixed(2)}${suffix}`;
  }
  return rupees.toFixed(0);
}

/**
 * `KSE100 - KSE-100 Index | My Portfolio 365` — symbol, name and brand, kept to 60 characters by
 * budgeting the name (the only unbounded part).
 */
export function indexMetaTitle(symbol: string, name: string | null | undefined): string {
  const brand = ` | ${BRAND}`;
  const label = (name ?? '').trim();
  // A placeholder name (the bare symbol) would read "KSE100PR - KSE100PR", so drop the name.
  if (!label || label.toUpperCase() === symbol.toUpperCase()) return `${symbol}${brand}`;
  const budget = TITLE_MAX - symbol.length - 3 - brand.length; // " - " between symbol and name
  const labelShown = budget >= 2 ? truncate(label, budget) : '';
  return labelShown ? `${symbol} - ${labelShown}${brand}` : `${symbol}${brand}`;
}

/**
 * The index meta description, one sentence per data point and each omitted when its value is
 * unknown — so an index whose source publishes no 52-week pair (or whose series is too short for a
 * return) reads a shorter, honest description rather than a `—`.
 */
export function indexMetaDescription(
  symbol: string,
  value: number | null | undefined,
  week52High: number | null | undefined,
  week52Low: number | null | undefined,
  return1y: number | null | undefined,
  returnYtd: number | null | undefined,
  marketCap: number | null | undefined,
): string {
  const v = formatPrice(value);
  const sentences: string[] = [];
  sentences.push(`The Current ${symbol} Index is ${v ?? '—'}.`);
  const hi = formatPrice(week52High);
  const lo = formatPrice(week52Low);
  if (hi && lo) {
    sentences.push(`In 52 Weeks ${symbol} Index has touched high of ${hi} and a Low of ${lo}.`);
  }
  const r1 = formatReturn(return1y);
  const rYtd = formatReturn(returnYtd);
  if (r1 && rYtd) {
    sentences.push(`In 1 Year ${symbol} Index has given return of ${r1} whereas year to date return is ${rYtd}.`);
  } else if (r1) {
    sentences.push(`In 1 Year ${symbol} Index has given return of ${r1}.`);
  } else if (rYtd) {
    sentences.push(`Year to date return is ${rYtd}.`);
  }
  const cap = formatMarketCapShort(marketCap);
  if (cap) {
    sentences.push(`Market Capitalization of ${symbol} is ${cap}.`);
  }
  return sentences.join(' ');
}
