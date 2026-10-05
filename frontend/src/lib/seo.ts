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
