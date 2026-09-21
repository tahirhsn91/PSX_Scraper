import { Router } from 'express';
import * as ctrl from '../controllers/index.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { paginationQuery, symbolParam, historyQuery, candlesQuery } from '../validators/schemas';
import { mutationLimiter } from '../middleware/rateLimit';

const router = Router();

router.get('/', validate(paginationQuery, 'query'), asyncHandler(ctrl.listIndices));
router.get('/:symbol', validate(symbolParam, 'params'), asyncHandler(ctrl.getIndex));
router.get(
  '/:symbol/candles',
  validate(symbolParam, 'params'),
  validate(candlesQuery, 'query'),
  asyncHandler(ctrl.indexCandles),
);
router.get(
  '/:symbol/history',
  validate(symbolParam, 'params'),
  validate(historyQuery, 'query'),
  asyncHandler(ctrl.indexHistory),
);
router.post('/:symbol/sync', mutationLimiter, validate(symbolParam, 'params'), asyncHandler(ctrl.syncIndex));
router.get('/:symbol/sync/status', validate(symbolParam, 'params'), asyncHandler(ctrl.indexSyncStatus));

export default router;
