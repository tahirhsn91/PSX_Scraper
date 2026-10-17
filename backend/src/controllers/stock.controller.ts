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
