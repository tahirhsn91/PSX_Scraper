import { RequestHandler } from 'express';
import { z } from 'zod';
import { indexService } from '../services/index.service';
import { valid } from '../middleware/validate';
import { paginationQuery, symbolParam, historyQuery } from '../validators/schemas';

type Pagination = z.infer<typeof paginationQuery>;
type Sym = z.infer<typeof symbolParam>;
type HistoryQuery = z.infer<typeof historyQuery>;

export const listIndices: RequestHandler = async (req, res) => {
  const { page, limit } = valid<Pagination>(req, 'query');
  res.json(await indexService.list(page, limit));
};

export const getIndex: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.json(await indexService.summary(symbol));
};

export const indexHistory: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  const q = valid<HistoryQuery>(req, 'query');
  res.json(await indexService.history(symbol, q));
};

export const syncIndex: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.status(202).json(await indexService.sync(symbol));
};

export const indexSyncStatus: RequestHandler = async (req, res) => {
  const { symbol } = valid<Sym>(req, 'params');
  res.json(await indexService.jobStatus(symbol));
};
