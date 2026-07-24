import { Router } from 'express';
import { search } from '../controllers/search.controller';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { searchQuery } from '../validators/schemas';

const router = Router();
router.get('/', validate(searchQuery, 'query'), asyncHandler(search));
export default router;
