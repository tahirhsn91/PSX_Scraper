import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { compare, COMPARE_PERIODS, type ComparePeriod } from '../services/compare.service';

const router = Router();

/**
 * `GET /compare?symbols=HBL,MCB,UBL&period=1y`
 *
 * Two to five symbols, one period for all of them: a chart mixing a one-month line with a one-year
 * line would not be a comparison, so there is no per-symbol period to send.
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const raw = String(req.query.symbols ?? '');
    const symbols = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const period = String(req.query.period ?? '1y').toLowerCase();

    if (symbols.length < 2 || symbols.length > 5) {
      res.status(422).json({
        error: { code: 'INVALID_SYMBOLS', message: 'symbols must hold between 2 and 5 tickers' },
      });
      return;
    }
    if (!symbols.every((s) => /^[A-Z0-9]{1,20}$/.test(s))) {
      res.status(422).json({ error: { code: 'INVALID_SYMBOLS', message: 'symbols must be ticker symbols' } });
      return;
    }
    if (!(period in COMPARE_PERIODS)) {
      res.status(422).json({
        error: {
          code: 'INVALID_PERIOD',
          message: `period must be one of ${Object.keys(COMPARE_PERIODS).join(', ')}`,
        },
      });
      return;
    }

    res.json(await compare(symbols, period as ComparePeriod));
  }),
);

export default router;
