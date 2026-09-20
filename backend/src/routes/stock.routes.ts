import { Router } from 'express';
import * as ctrl from '../controllers/stock.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { stocksQuery, addStockBody, symbolParam, historyQuery, historySyncBody, candlesQuery } from '../validators/schemas';
import { mutationLimiter } from '../middleware/rateLimit';

const router = Router();

router.get('/', validate(stocksQuery, 'query'), asyncHandler(ctrl.listStocks));
// Candles sit before the by-symbol routes: /:symbol matches one segment, so this is
// unambiguous, but keeping the chart's endpoint next to the list makes the read paths read
// together.
router.get(
  '/:symbol/candles',
  validate(symbolParam, 'params'),
  validate(candlesQuery, 'query'),
  asyncHandler(ctrl.stockCandles),
);
router.post('/', mutationLimiter, validate(addStockBody, 'body'), asyncHandler(ctrl.addStock));
router.get('/:symbol', validate(symbolParam, 'params'), asyncHandler(ctrl.getStock));
router.delete('/:symbol', validate(symbolParam, 'params'), asyncHandler(ctrl.deleteStock));
router.post('/:symbol/sync', mutationLimiter, validate(symbolParam, 'params'), asyncHandler(ctrl.syncStock));
router.get(
  '/:symbol/history',
  validate(symbolParam, 'params'),
  validate(historyQuery, 'query'),
  asyncHandler(ctrl.stockHistory),
);
router.post(
  '/:symbol/history/sync',
  mutationLimiter,
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
