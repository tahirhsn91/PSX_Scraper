import { RequestHandler } from 'express';
import { z } from 'zod';
import { stockService } from '../services/stock.service';
import { betaService } from '../services/beta.service';
import { syncService } from '../services/sync.service';
import { marketCapService } from '../services/marketCap.service';
import { stockLogoService } from '../services/stockLogo.service';
import { valid } from '../middleware/validate';
import { stocksQuery, addStockBody, symbolParam, historyQuery, historySyncBody, candlesQuery } from '../validators/schemas';

type StocksQuery = z.infer<typeof stocksQuery>;
type Sym = z.infer<typeof symbolParam>;

export const listStocks: RequestHandler = async (req, res) => {
  const { page, limit, sort, order, group, index } = valid<StocksQuery>(req, 'query');
  res.json(await stockService.list(page, limit, sort, order, group, index));
};

export const getStock: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.json(await stockService.getDetail(symbol));
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
