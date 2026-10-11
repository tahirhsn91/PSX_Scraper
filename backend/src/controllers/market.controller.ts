import { RequestHandler } from 'express';
import { z } from 'zod';
import { marketService } from '../services/market.service';
import { valid } from '../middleware/validate';
import { calendarQuery } from '../validators/schemas';

/** Breadth + movers, one payload for the dashboard's market-summary surface. */
export const marketOverview: RequestHandler = async (_req, res) => {
  res.json(await marketService.overview());
};

/** Every sector's aggregate, for the sector browser. */
export const sectors: RequestHandler = async (_req, res) => {
  res.json({ items: await marketService.sectors() });
};

/** Upcoming dividend calendar plus the highest-yield ranking. */
export const dividends: RequestHandler = async (req, res) => {
  const { limit } = valid<z.infer<typeof calendarQuery>>(req, 'query');
  res.json(await marketService.dividends(limit));
};
