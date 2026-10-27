import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { valid, validate } from '../middleware/validate';
import { roiLimiter } from '../middleware/rateLimit';
import { cacheGet, cacheSet } from '../services/cache';
import { calculateRoi, type RoiMode } from '../services/roi.service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query contract.
 *
 * Every field is bounded here rather than in the service: an unbounded `amount` or a twenty-year
 * window is a denial-of-service vector on a public read endpoint, and a bound in the schema fails
 * with a 400 before a single row is read.
 */
const roiQuery = z.object({
  mode: z.enum(['single', 'dca', 'compare']).default('single'),
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,20}$/).optional(),
  symbols: z.string().trim().toUpperCase().optional(),
  start: z.string().regex(ISO_DATE, 'start must be YYYY-MM-DD'),
  end: z.string().regex(ISO_DATE, 'end must be YYYY-MM-DD').optional(),
  amount: z.coerce.number().min(100).max(100_000_000),
  dayOfMonth: z.coerce.number().int().min(1).max(31).default(1),
  feePct: z.coerce.number().min(0).max(5).default(0.15),
  feeFlat: z.coerce.number().min(0).max(10_000).default(0),
  divTax: z.coerce.number().min(0).max(50).default(0),
  cgt: z.coerce.number().min(0).max(50).default(0),
});

const router = Router();

/**
 * `GET /api/v1/roi?mode=single&symbol=FFC&start=2025-01-02&amount=100000`
 *
 * Read-only and shareable: the same URL returns the same answer, which is why it is a GET with
 * query parameters rather than a POST body. Results are cached for a minute — the inputs move
 * intraday at most, and a minute of staleness is invisible next to the session close the maths uses.
 */
router.get(
  '/',
  roiLimiter,
  validate(roiQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = valid<z.infer<typeof roiQuery>>(req, 'query');

    const list = (q.symbols ?? q.symbol ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const input = {
      mode: q.mode as RoiMode,
      symbols: list,
      start: q.start,
      end: q.end,
      amount: q.amount,
      dayOfMonth: q.dayOfMonth,
      feePct: q.feePct,
      feeFlat: q.feeFlat,
      divTaxPct: q.divTax,
      cgtPct: q.cgt,
    };

    const key = `roi:v1:${JSON.stringify(input)}`;
    const hit = await cacheGet<unknown>(key);
    if (hit) {
      res.setHeader('X-Cache', 'HIT');
      res.json(hit);
      return;
    }

    const result = await calculateRoi(input);
    await cacheSet(key, result, 60);
    res.setHeader('X-Cache', 'MISS');
    res.json(result);
  }),
);

export default router;
