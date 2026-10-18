import { Router } from 'express';
import * as ctrl from '../controllers/stock.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { stocksQuery, addStockBody, symbolParam, historyQuery, historySyncBody, candlesQuery } from '../validators/schemas';
import { mutationLimiter } from '../middleware/rateLimit';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

router.get('/', validate(stocksQuery, 'query'), asyncHandler(ctrl.listStocks));
// Indicators sit before the by-symbol read: /:symbol matches one segment, so this is unambiguous,
// and both read paths stay together.
router.get(
  '/:symbol/indicators',
  validate(symbolParam, 'params'),
  asyncHandler(ctrl.indicators),
);

// Candles next to the indicators: the chart and the analysis are two views of the same sessions.
router.get(
  '/:symbol/candles',
  validate(symbolParam, 'params'),
  validate(candlesQuery, 'query'),
  asyncHandler(ctrl.stockCandles),
);
router.post('/', mutationLimiter, requireAdmin, validate(addStockBody, 'body'), asyncHandler(ctrl.addStock));
// Two segments, so the one-segment `/:symbol` routes below cannot shadow it. The company profile
// is its own read for the same reason it is its own controller: it is editorial content the page
// fetches after the numbers, and it is absent for most symbols.
router.get(
  '/:symbol/profile',
  validate(symbolParam, 'params'),
  asyncHandler(ctrl.stockProfile),
);
// Two segments, so the one-segment `/:symbol` routes below cannot shadow it.
router.post('/market-cap/refresh', mutationLimiter, requireAdmin, asyncHandler(ctrl.refreshMarketCaps));
router.post('/beta/refresh', mutationLimiter, requireAdmin, asyncHandler(ctrl.refreshBeta));
router.post('/logos/refresh', mutationLimiter, requireAdmin, asyncHandler(ctrl.refreshStockLogos));
// Before `/:symbol`, or "presets" would be read as a ticker.
router.get('/presets', asyncHandler(ctrl.listPresets));
router.get('/:symbol', validate(symbolParam, 'params'), asyncHandler(ctrl.getStock));
router.delete('/:symbol', requireAdmin, validate(symbolParam, 'params'), asyncHandler(ctrl.deleteStock));
router.post('/:symbol/sync', mutationLimiter, requireAdmin, validate(symbolParam, 'params'), asyncHandler(ctrl.syncStock));
router.get(
  '/:symbol/performance',
  validate(symbolParam, 'params'),
  asyncHandler(ctrl.stockPerformance),
);
router.get(
  '/:symbol/history',
  validate(symbolParam, 'params'),
  validate(historyQuery, 'query'),
  asyncHandler(ctrl.stockHistory),
);
router.post(
  '/:symbol/history/sync',
  mutationLimiter, requireAdmin,
  validate(symbolParam, 'params'),
  validate(historySyncBody, 'body'),
  asyncHandler(ctrl.syncHistory),
);
router.get(
  '/:symbol/history/status',
  validate(symbolParam, 'params'),
  asyncHandler(ctrl.historyStatus),
);

export default router;
