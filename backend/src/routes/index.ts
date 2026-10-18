import { Router } from 'express';
import stockRoutes from './stock.routes';
import searchRoutes from './search.routes';
import syncRoutes from './sync.routes';
import indexRoutes from './indices.routes';
import marketRoutes from './market.routes';
import compareRoutes from './compare.routes';

const router = Router();
router.use('/stocks', stockRoutes);
router.use('/indices', indexRoutes);
router.use('/search', searchRoutes);
router.use('/sync', syncRoutes);
router.use('/market', marketRoutes);
router.use('/compare', compareRoutes);
export default router;
