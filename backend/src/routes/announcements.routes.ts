import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { valid, validate } from '../middleware/validate';
import { ANNOUNCEMENT_CATEGORIES, listAnnouncements } from '../services/announcements.service';

const listQuery = z.object({
  symbol: z.string().trim().min(1).max(20).optional(),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export const announcementsRouter = Router();

/**
 * Official notices, newest first.
 *
 * An empty page is a valid answer, not an error: the ingestor is the only writer and a fresh
 * deployment has nothing to show. The UI states that rather than pretending the market was silent.
 */
announcementsRouter.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = valid<z.infer<typeof listQuery>>(req, 'query');
    res.json(await listAnnouncements(q));
  }),
);
