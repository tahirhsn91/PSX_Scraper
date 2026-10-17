import { moversRepository, type MoverStatRow } from '../repositories/movers.repository';

/**
 * Ranked movers, with the period each ranking is measured over.
 *
 * Two rules are stated rather than implied, because a ranking that hides either is misleading:
 *
 * - **Illiquid symbols are excluded**, and the count is returned. A 40% move on 200 shares is a
 *   print, not a market; listing it above a 5% move on two million shares inverts what the page is
 *   for. The floor is on *shares*, because none of the sources this app reads publishes a rupee
 *   turnover — the payload says so instead of inventing one.
 * - **Relative volume needs history**. With fewer than five stored sessions the 20-session average
 *   is noise, so the multiple is null rather than a number computed from two days.
 */

export type MoverType = 'gainers' | 'losers' | 'active' | 'unusual';
export type MoverPeriod = '1d' | '1w' | '1m';

/** Shares traded in the session below which a symbol is not ranked. */
export const LIQUIDITY_FLOOR_SHARES = 10_000;

/** Sessions needed before a relative-volume multiple means anything. */
export const MIN_SESSIONS_FOR_RELATIVE_VOLUME = 5;

export interface MoverRow {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Return over the selected period; `1d` uses the source's own change%, not a recomputation. */
  periodReturnPercent: number | null;
  volume: number | null;
  avgVolume20: number | null;
  relativeVolume: number | null;
  /** Why this row is on this list, in words a reader can check against the columns. */
  reason: string;
}

export interface MoversPayload {
  type: MoverType;
  period: MoverPeriod;
  sessionDate: string | null;
  rows: MoverRow[];
  meta: {
    ranked: number;
    excludedIlliquid: number;
    liquidityFloorShares: number;
    relativeVolumeFormula: string;
    tradedValueNote: string;
  };
}

const round = (v: number, dp = 2): number => Math.round(v * 10 ** dp) / 10 ** dp;

/** Percent change from `from` to `price`, or null when either side is unusable. */
const pctFrom = (price: number | null, from: number | null): number | null => {
  if (price === null || from === null || from <= 0) return null;
  return round(((price - from) / from) * 100);
};

/**
 * The return the ranking is measured on.
 *
 * `1d` deliberately reuses the source's published change% rather than recomputing from our stored
 * previous close: that is the figure the exchange itself reports, and it is the one a reader can
 * check on the PSX site. The multi-session periods are ours, computed from stored closes.
 */
export function periodReturn(row: MoverStatRow, period: MoverPeriod): number | null {
  if (period === '1d') return row.changePercent ?? pctFrom(row.price, row.prevClose);
  if (period === '1w') return pctFrom(row.price, row.close1w);
  return pctFrom(row.price, row.close1m);
}

const PERIOD_WORDS: Record<MoverPeriod, string> = {
  '1d': 'today',
  '1w': 'over 5 sessions',
  '1m': 'over ~20 sessions',
};

const signed = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

function reasonFor(row: MoverRow, type: MoverType, period: MoverPeriod): string {
  const ret = row.periodReturnPercent;
  if (type === 'gainers' || type === 'losers') {
    return ret === null ? 'no comparable close' : `${signed(ret)} ${PERIOD_WORDS[period]}`;
  }
  // The multiple is already a column; the reason adds the figure it is measured against, which is
  // the part a reader cannot see ("16×" of what?).
  const volume = row.volume === null ? null : row.volume.toLocaleString('en-PK');
  const average = row.avgVolume20 === null ? null : row.avgVolume20.toLocaleString('en-PK');
  if (row.relativeVolume !== null && volume && average) {
    return `${volume} shares vs a ${average} average`;
  }
  return volume ? `${volume} shares traded` : 'volume ranked';
}

const byNumber = (a: number | null, b: number | null): number => (b ?? -Infinity) - (a ?? -Infinity);

/**
 * Turn raw per-symbol stats into a ranked list.
 *
 * Pure on purpose: the liquidity rule, the sort and the "why" text are the parts most likely to be
 * wrong, and they can be tested without a database or a network.
 */
export function rankMovers(
  stats: MoverStatRow[],
  type: MoverType,
  period: MoverPeriod,
  limit: number,
): { rows: MoverRow[]; excludedIlliquid: number } {
  let excludedIlliquid = 0;
  const eligible = stats.filter((s) => {
    const liquid = s.volume !== null && s.volume >= LIQUIDITY_FLOOR_SHARES;
    if (!liquid) excludedIlliquid += 1;
    return liquid;
  });

  const rows: MoverRow[] = eligible.map((s) => {
    const relativeVolume =
      s.avgVolume20 !== null && s.avgVolume20 > 0 && s.sessions >= MIN_SESSIONS_FOR_RELATIVE_VOLUME
        ? round((s.volume ?? 0) / s.avgVolume20)
        : null;
    return {
      symbol: s.symbol,
      companyName: s.companyName,
      sector: s.sector,
      price: s.price,
      change: s.change,
      changePercent: s.changePercent,
      periodReturnPercent: periodReturn(s, period),
      volume: s.volume,
      avgVolume20: s.avgVolume20 === null ? null : Math.round(s.avgVolume20),
      relativeVolume,
      reason: '',
    };
  });

  const ranked = rows
    .filter((r) => (type === 'active' ? r.volume !== null : true))
    .sort((a, b) => {
      switch (type) {
        case 'gainers':
          return byNumber(a.periodReturnPercent, b.periodReturnPercent);
        case 'losers':
          // Ascending: the biggest fall first — spelled out because `byNumber` is descending.
          return (a.periodReturnPercent ?? Infinity) - (b.periodReturnPercent ?? Infinity);
        case 'unusual':
          return byNumber(a.relativeVolume, b.relativeVolume);
        case 'active':
        default:
          return byNumber(a.volume, b.volume);
      }
    })
    .slice(0, limit);

  for (const row of ranked) row.reason = reasonFor(row, type, period);

  return { rows: ranked, excludedIlliquid };
}

export const moversService = {
  async list(type: MoverType, period: MoverPeriod, limit: number): Promise<MoversPayload> {
    const stats = await moversRepository.stats();
    const { rows, excludedIlliquid } = rankMovers(stats, type, period, limit);

    return {
      type,
      period,
      // The newest session any ranked symbol carries — the ranking's own date, not the wall clock.
      sessionDate: stats.reduce<string | null>(
        (max, s) => (s.sessionDate && (!max || s.sessionDate > max) ? s.sessionDate : max),
        null,
      ),
      rows,
      meta: {
        ranked: rows.length,
        excludedIlliquid,
        liquidityFloorShares: LIQUIDITY_FLOOR_SHARES,
        relativeVolumeFormula: 'relative volume = session volume ÷ average volume of the last 20 sessions',
        tradedValueNote:
          'Traded value is not published by the sources this app reads, so the liquidity floor is on shares.',
      },
    };
  },
};
