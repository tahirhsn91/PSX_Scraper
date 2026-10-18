import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { valid, validate } from '../middleware/validate';
import { marketRepository } from '../repositories/market.repository';

const ledgerQuery = z.object({
  symbol: z.string().trim().min(1).max(20).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minYield: z.coerce.number().min(0).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

const router = Router();

/**
 * The dividend ledger — every declared dividend, newest first.
 *
 * No row is dropped for a missing date: `—` is the honest rendering of "the source does not publish
 * this", and `status` says `unknown` rather than pretending a dividend was or was not paid.
 */
router.get(
  '/',
  validate(ledgerQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = valid<z.infer<typeof ledgerQuery>>(req, 'query');
    res.json(await marketRepository.dividendLedger(q));
  }),
);

export default router;
