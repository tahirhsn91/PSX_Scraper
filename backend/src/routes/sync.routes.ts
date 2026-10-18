import { Router } from 'express';
import * as ctrl from '../controllers/sync.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { clearFailedBody, logsQuery } from '../validators/schemas';
import { mutationLimiter } from '../middleware/rateLimit';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();
router.post('/all', mutationLimiter, requireAdmin, asyncHandler(ctrl.syncAll));
router.get('/status', asyncHandler(ctrl.syncStatus));
router.get('/sources', asyncHandler(ctrl.dataSources));
router.get('/logs', validate(logsQuery, 'query'), asyncHandler(ctrl.syncLogs));
router.post('/failed/clear', mutationLimiter, requireAdmin, validate(clearFailedBody, 'body'), asyncHandler(ctrl.clearFailed));
export default router;
