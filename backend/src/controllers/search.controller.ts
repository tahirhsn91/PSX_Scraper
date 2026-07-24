import { RequestHandler } from 'express';
import { z } from 'zod';
import { searchService } from '../services/search.service';
import { valid } from '../middleware/validate';
import { searchQuery } from '../validators/schemas';

export const search: RequestHandler = async (req, res) => {
  const { q, limit } = valid<z.infer<typeof searchQuery>>(req, 'query');
  res.json(await searchService.search(q, limit));
};
