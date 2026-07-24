import { RequestHandler } from 'express';
import { z } from 'zod';
import { syncService } from '../services/sync.service';
import { valid } from '../middleware/validate';
import { logsQuery } from '../validators/schemas';

export const syncAll: RequestHandler = async (_req, res) => {
  res.status(202).json(await syncService.syncAll());
};

export const syncStatus: RequestHandler = async (_req, res) => {
  res.json(await syncService.status());
};

export const syncLogs: RequestHandler = async (req, res) => {
  const q = valid<z.infer<typeof logsQuery>>(req, 'query');
  res.json(await syncService.logs(q));
};
