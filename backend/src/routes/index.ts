import { Router } from 'express';
import stockRoutes from './stock.routes';
import searchRoutes from './search.routes';
import syncRoutes from './sync.routes';
import indexRoutes from './indices.routes';

const router = Router();
router.use('/stocks', stockRoutes);
router.use('/indices', indexRoutes);
router.use('/search', searchRoutes);
router.use('/sync', syncRoutes);
export default router;
