import { Router } from 'express';
import * as ctrl from '../controllers/market.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { calendarQuery } from '../validators/schemas';

const router = Router();

router.get('/overview', asyncHandler(ctrl.marketOverview));
router.get('/sectors', asyncHandler(ctrl.sectors));
router.get('/dividends', validate(calendarQuery, 'query'), asyncHandler(ctrl.dividends));

export default router;
