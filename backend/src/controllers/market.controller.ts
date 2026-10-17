import { RequestHandler } from 'express';
import { z } from 'zod';
import { marketService } from '../services/market.service';
import { marketStatusService } from '../services/marketStatus.service';
import { moversService } from '../services/movers.service';
import { valid } from '../middleware/validate';
import { calendarQuery, moversQuery } from '../validators/schemas';

/** Breadth + movers, one payload for the dashboard's market-summary surface. */
export const marketOverview: RequestHandler = async (_req, res) => {
  res.json(await marketService.overview());
};

/**
 * Session state and per-dataset freshness. Polled by every page that shows a number, so it must
 * stay cheap: four indexed lookups, no source call.
 */
export const marketStatus: RequestHandler = async (_req, res) => {
  res.json(await marketStatusService.status());
};

/** Ranked gainers / losers / activity, each measured over the period the caller asks for. */
export const movers: RequestHandler = async (req, res) => {
  const { type, period, limit } = valid<z.infer<typeof moversQuery>>(req, 'query');
  res.json(await moversService.list(type, period, limit));
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
