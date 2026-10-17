import { RequestHandler } from 'express';
import { z } from 'zod';
import { stockService } from '../services/stock.service';
import type { StockFilters } from '../repositories/stock.repository';
import { betaService } from '../services/beta.service';
import { syncService } from '../services/sync.service';
import { marketCapService } from '../services/marketCap.service';
import { stockLogoService } from '../services/stockLogo.service';
import { companyProfileService } from '../services/companyProfile.service';
import { SCREENER_PRESETS, presetSummaries } from '../services/screenerPresets';
import { computeIndicators, type IndicatorKey } from '../services/indicators.service';
import { cacheGet, cacheSet } from '../services/cache';
import { HISTORY_RANGES, rangeToFrom, type HistoryRange } from '../utils/range';
import { valid } from '../middleware/validate';
import { stocksQuery, addStockBody, symbolParam, historyQuery, historySyncBody, candlesQuery } from '../validators/schemas';

type StocksQuery = z.infer<typeof stocksQuery>;
type Sym = z.infer<typeof symbolParam>;

/** The screener fields off a validated query, or undefined when none were sent. */
function toStockFilters(q: StocksQuery): StockFilters | undefined {
  const f: StockFilters = {};
  if (q.sector) f.sector = q.sector;
  if (q.minPrice != null) f.minPrice = q.minPrice;
  if (q.maxPrice != null) f.maxPrice = q.maxPrice;
  if (q.minMarketCap != null) f.minMarketCap = q.minMarketCap;
  if (q.maxMarketCap != null) f.maxMarketCap = q.maxMarketCap;
  if (q.minChangePercent != null) f.minChangePercent = q.minChangePercent;
  if (q.maxChangePercent != null) f.maxChangePercent = q.maxChangePercent;
  if (q.minPe != null) f.minPe = q.minPe;
  if (q.maxPe != null) f.maxPe = q.maxPe;
  if (q.minPb != null) f.minPb = q.minPb;
  if (q.maxPb != null) f.maxPb = q.maxPb;
  if (q.minDividendYield != null) f.minDividendYield = q.minDividendYield;
  if (q.minRoe != null) f.minRoe = q.minRoe;
  if (q.maxDebtToEquity != null) f.maxDebtToEquity = q.maxDebtToEquity;
  if (q.minReturn != null) f.minReturn = q.minReturn;
  if (q.maxReturn != null) f.maxReturn = q.maxReturn;
  // A return bound or a sort by return needs a window. Default it here, once, so the repository can
  // assume a period whenever it has to join the return lateral.
  if (q.returnPeriod) f.returnPeriod = q.returnPeriod;
  else if (q.minReturn != null || q.maxReturn != null || q.sort === 'return') f.returnPeriod = '1m';
  if (q.symbols?.length) f.symbols = q.symbols;
  return Object.keys(f).length > 0 ? f : undefined;
}

export const listStocks: RequestHandler = async (req, res) => {
  const q = valid<StocksQuery>(req, 'query');
  const preset = q.preset ? SCREENER_PRESETS[q.preset] : undefined;

  // A preset supplies its own criteria and ordering; explicit screener filters may narrow it
  // further (a preset inside a sector), but they cannot widen what the preset means.
  const filters = preset ? { ...preset.filters, ...(toStockFilters(q) ?? {}) } : toStockFilters(q);
  const sort = q.sort ?? preset?.sort;
  const order = q.sort ? q.order : preset?.order ?? q.order;

  const result = await stockService.list(q.page, q.limit, sort, order, q.group, q.index, filters);

  if (preset) {
    const start = (result.page - 1) * result.limit;
    // The rank is absolute across pages, so page two's first row is #26, not #1.
    result.items = result.items.map((row, i) => ({
      ...row,
      reason: preset.reason(row, start + i + 1, result.total),
    }));
  }

  res.json({
    ...result,
    ...(preset
      ? {
          preset: {
            key: preset.key,
            label: preset.label,
            description: preset.description,
            caveat: preset.caveat,
          },
        }
      : {}),
  });
};

/** The preset catalogue, for the screener's chips. */
export const listPresets: RequestHandler = async (_req, res) => {
  res.json({ items: presetSummaries() });
};

export const getStock: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.json(await stockService.getDetail(symbol));
};

/**
 * The stock page's "Company Description" section.
 *
 * Separate from `getStock` on purpose. The detail payload is what the page waits on before it can
 * paint anything, and this content is editorial, below the fold, and absent for most symbols — so
 * it gets its own read the page can make lazily, rather than a few hundred more bytes of usually-null
 * fields on the hot path.
 */
export const stockProfile: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.json(await companyProfileService.get(symbol));
};

export const addStock: RequestHandler = async (req, res) => {
  const { symbol, force } = valid<z.infer<typeof addStockBody>>(req, 'body');
  const result = await stockService.add(symbol, { force });
  res.status(201).json({ symbol, id: result.stock.id, jobId: result.jobId });
};

export const deleteStock: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  await stockService.remove(symbol);
  res.status(204).send();
};

export const syncStock: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.status(202).json(await syncService.syncOne(symbol));
};

/**
 * Refresh market caps across the tracked universe. On demand for the same reason the membership
 * pass is: a stack that has the column but no value should not have to wait for a schedule to see
 * one, and this is the endpoint that fills a fresh database.
 */
export const refreshMarketCaps: RequestHandler = async (_req, res) => {
  res.json(await marketCapService.refresh());
};

/**
 * Recompute beta for every tracked symbol (#79, criterion 7).
 *
 * On demand for the same reason the market-cap refresh is: beta is derived from our own stored
 * history, so a stack that has the column but no value yet should not have to wait for all ~500
 * symbols to be synced once. Nothing is fetched — the whole pass is local SQL — so there is no
 * request budget here, only the symbol count.
 */
export const refreshBeta: RequestHandler = async (_req, res) => {
  res.json(await betaService.refreshAll());
};

/**
 * Refresh company logos across the tracked universe. On demand for the same reason the market-cap
 * refresh is: a stack that has the column but no icon should not have to wait for the schedule to
 * see one, and this is the endpoint that fills a fresh database.
 */
export const refreshStockLogos: RequestHandler = async (_req, res) => {
  res.json(await stockLogoService.refresh());
};

export const stockCandles: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  const q = valid<z.infer<typeof candlesQuery>>(req, 'query');
  res.json(await stockService.candles(symbol, q));
};

export const stockHistory: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  const q = valid<z.infer<typeof historyQuery>>(req, 'query');
  res.json(await stockService.history(symbol, q));
};

export const syncHistory: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  const { range } = valid<z.infer<typeof historySyncBody>>(req, 'body');
  res.status(202).json(await syncService.syncHistory(symbol, range));
};

export const historyStatus: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.json(await syncService.historyJobStatus(symbol));
};

const INDICATOR_SETS: IndicatorKey[] = ['sma', 'ema', 'rsi', 'macd', 'bb', 'atr', 'relvol'];
const DEFAULT_SETS: IndicatorKey[] = ['sma', 'ema', 'rsi', 'macd', 'bb', 'atr', 'relvol'];

/** `?sets=sma,rsi` → a de-duplicated list; unknown names are ignored rather than silently mapped. */
function parseSets(raw: unknown): IndicatorKey[] {
  const asked = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (asked.length === 0) return DEFAULT_SETS;
  const valid = asked.filter((s): s is IndicatorKey => (INDICATOR_SETS as string[]).includes(s));
  return valid.length > 0 ? [...new Set(valid)] : DEFAULT_SETS;
}

/**
 * Technical indicators for one symbol.
 *
 * Cached for five minutes per symbol/range/sets: the inputs only change when a sync writes a new
 * session, and a chart re-reads this on every period switch. The cache holds the computed payload,
 * so a warm request is a Redis read and no database work at all.
 */
export const indicators: RequestHandler = async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  // Ranges are upper-case in this app ('1Y'); anything unrecognised is refused rather than
  // silently treated as "all history", which would quietly return a decade of candles.
  const rangeRaw = String(req.query.range ?? '1Y').toUpperCase();
  if (!(HISTORY_RANGES as readonly string[]).includes(rangeRaw)) {
    res.status(422).json({
      error: { code: 'INVALID_RANGE', message: `range must be one of ${HISTORY_RANGES.join(', ')}` },
    });
    return;
  }
  const range = rangeRaw as HistoryRange;
  const sets = parseSets(req.query.sets);

  // Versioned: the cached payload embeds the maths, so a change to the engine must not keep
  // serving the previous answers for five minutes.
  const key = `indicators:v1:${symbol}:${range}:${[...sets].sort().join(',')}`;
  const cached = await cacheGet<Record<string, unknown>>(key);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    res.json(cached);
    return;
  }

  // Look back further than the requested window: a 1Y chart of SMA(200) still needs 200 sessions
  // *before* its first point, or the line would only appear in its last quarter. The output is
  // trimmed back to the requested window after the maths.
  const cutoff = rangeToFrom(range);
  const lookback = cutoff ? new Date(cutoff.getTime() - 500 * 86_400_000) : undefined;
  const candles = await stockService.candles(symbol, { from: lookback });
  const cutoffIso = cutoff ? cutoff.toISOString().slice(0, 10) : null;
  const series = computeIndicators(candles.items, sets).map((s) => {
    if (!cutoffIso) return s;
    const points = s.points.filter((p) => p.date >= cutoffIso);
    const valid = points.filter((p) => p.value !== null);
    return {
      ...s,
      points,
      windowStart: valid[0]?.date ?? null,
      windowEnd: valid[valid.length - 1]?.date ?? null,
      insufficientData: valid.length === 0,
      availableSessions: points.length,
    };
  });

  // Report the requested window, not the lookback the maths needed: `sessions` is what the caller
  // asked for, and a 1M request that reports 375 sessions would be describing the query, not the answer.
  const windowCandles = cutoffIso ? candles.items.filter((c) => c.time >= cutoffIso) : candles.items;

  const payload = {
    symbol,
    range,
    sessions: windowCandles.length,
    from: windowCandles[0]?.time ?? null,
    to: windowCandles[windowCandles.length - 1]?.time ?? null,
    // The same caveats the candles endpoint reports: readings dropped as implausible, and readings
    // kept with fields nulled. An indicator built on a sanitised close should say so.
    skipped: candles.skipped,
    sanitised: candles.sanitised,
    series,
  };

  await cacheSet(key, payload, 300);
  res.setHeader('X-Cache', 'MISS');
  res.json(payload);
};
