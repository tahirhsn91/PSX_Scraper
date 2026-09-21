import { RequestHandler } from 'express';
import { z } from 'zod';
import { stockService } from '../services/stock.service';
import { syncService } from '../services/sync.service';
import { valid } from '../middleware/validate';
import { stocksQuery, addStockBody, symbolParam, historyQuery, historySyncBody, candlesQuery } from '../validators/schemas';

type StocksQuery = z.infer<typeof stocksQuery>;
type Sym = z.infer<typeof symbolParam>;

export const listStocks: RequestHandler = async (req, res) => {
  const { page, limit, sort, order } = valid<StocksQuery>(req, 'query');
  res.json(await stockService.list(page, limit, sort, order));
};

export const getStock: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.json(await stockService.getDetail(symbol));
};

export const addStock: RequestHandler = async (req, res) => {
  const { symbol } = valid<z.infer<typeof addStockBody>>(req, 'body');
  const result = await stockService.add(symbol);
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
