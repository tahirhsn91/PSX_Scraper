import { childLogger } from '../utils/logger';
import { SiteUnavailableError } from '../types/errors';

/**
 * Daily OHLCV history from Yahoo Finance, for PSX symbols.
 *
 * Why this exists: our own history source is PSX DPS (`/timeseries/eod/{symbol}`), and this
 * host is refused by that endpoint — every data path returns nothing while the site root still
 * answers. Without a second source most symbols can only ever show the handful of sessions the
 * live poll has seen.
 *
 * Why it is trustworthy: Yahoo's PSX series overlaps the DPS-era rows already in our database
 * and matches them exactly. For FFC 2025-09-16 it reports open 457.15 / close 452.59 / volume
 * 1,595,164 where our own DPS row holds 457.15 / 452.59 / 1,595,164; 2026-09-11 matches the
 * same way. It also carries what the DPS EOD feed omits — high and low — which is what makes a
 * complete candle possible.
 *
 * Karachi symbols are `<SYMBOL>.KA` on Yahoo. That is a naming rule, not a list, so any symbol
 * the scraper tracks can be asked for without touching this file. Not every PSX instrument is
 * covered: ETFs and the indices are absent (checked: ACIETF.KA, ^KSE, ^KSE30 all 404), and
 * their absence is reported rather than papered over.
 */
export interface DailyBar {
  /** Exchange session day, YYYY-MM-DD. */
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
/** How much history to ask for. `interval=1d` keeps it daily rather than aggregated. */
const RANGE = '10y';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/** The Yahoo ticker for a PSX symbol. */
export function yahooTicker(symbol: string): string {
  return `${symbol.trim().toUpperCase()}.KA`;
}

type YahooChart = {
  chart?: {
    error?: { code?: string; description?: string } | null;
    result?: Array<{
      meta?: { shortName?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Yahoo's payload to daily bars, oldest first.
 *
 * Bars without a close are dropped: a candle with no price would have to be invented to draw.
 * Missing high/low/open/volume stay null — the chart decides how to render a gap, and filling
 * one here would be asserting a number nobody reported.
 */
export function parseDailyBars(payload: YahooChart): DailyBar[] {
  const result = payload.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};
  const bars: DailyBar[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const close = num(q.close?.[i]);
    const stamp = stamps[i];
    if (close === null || typeof stamp !== 'number') continue;
    bars.push({
      // The session day, in UTC: Yahoo stamps daily bars at the session open in exchange time,
      // and for Karachi that lands on the intended calendar date.
      date: new Date(stamp * 1000).toISOString().slice(0, 10),
      open: num(q.open?.[i]),
      high: num(q.high?.[i]),
      low: num(q.low?.[i]),
      close,
      volume: num(q.volume?.[i]),
    });
  }
  return bars;
}

async function getJson(url: string, attempt = 1): Promise<YahooChart> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt <= 3) {
      // Yahoo rate-limits; back off rather than hammering it, and never retry a 404 (that
      // symbol simply is not in their universe).
      await new Promise((r) => setTimeout(r, attempt * 1500));
      return getJson(url, attempt + 1);
    }
    throw new SiteUnavailableError(`yahoo http ${res.status}`);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 120);
    throw new SiteUnavailableError(`yahoo http ${res.status}: ${body}`);
  }
  return (await res.json()) as YahooChart;
}

/** Daily bars for a PSX symbol. Throws when Yahoo has no series for it (ETFs, indices). */
export async function fetchDailyBars(symbol: string): Promise<DailyBar[]> {
  const log = childLogger({ symbol: symbol.toUpperCase(), op: 'yahoo-history' });
  const ticker = yahooTicker(symbol);
  const url = `${BASE}/${encodeURIComponent(ticker)}?range=${RANGE}&interval=1d&events=div%2Csplit`;
  const payload = await getJson(url);
  if (payload.chart?.error) {
    throw new SiteUnavailableError(
      `yahoo: ${payload.chart.error.code ?? 'error'} ${payload.chart.error.description ?? ''}`.trim(),
    );
  }
  const bars = parseDailyBars(payload);
  log.info('yahoo-history.done', { ticker, bars: bars.length });
  return bars;
}
