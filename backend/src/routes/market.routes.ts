import { Router } from 'express';
import * as ctrl from '../controllers/market.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { calendarQuery, moversQuery } from '../validators/schemas';

const router = Router();

router.get('/overview', asyncHandler(ctrl.marketOverview));
router.get('/status', asyncHandler(ctrl.marketStatus));
router.get('/movers', validate(moversQuery, 'query'), asyncHandler(ctrl.movers));
router.get('/sectors', asyncHandler(ctrl.sectors));
// A single segment with the name in the query: several sector names contain a slash, which a path
// parameter would split.
router.get('/sector', asyncHandler(ctrl.sectorDetail));
router.get('/dividends', validate(calendarQuery, 'query'), asyncHandler(ctrl.dividends));

export default router;
