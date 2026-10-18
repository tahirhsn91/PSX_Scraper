import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { eventBody } from '../validators/eventSchemas';
import { analyticsEnabled, EVENT_RETENTION_DAYS } from '../analytics/events';
import { productEventRepository } from '../repositories/productEvent.repository';
import { redis } from '../services/cache';

const router = Router();

/** Events are far more frequent than mutations, so a wider budget than `mutationLimiter`. */
const eventsLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: new RedisStore({ sendCommand: (...args: string[]) => (redis as any).call(...args) }),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many events.' } },
});

/**
 * POST /analytics/events — the collector.
 *
 * Answers 204 even when collection is switched off, so a client that still sends events does not
 * fill its console with failures. Nothing is stored in that case.
 */
router.post(
  '/events',
  eventsLimiter,
  validate(eventBody, 'body'),
  asyncHandler(async (req, res) => {
    if (!analyticsEnabled()) {
      res.status(204).end();
      return;
    }
    const { name, path, props } = req.body as {
      name: string;
      path?: string;
      props?: Record<string, string | number | boolean>;
    };
    await productEventRepository.record(name, path ?? null, props ?? null);
    res.status(204).end();
  }),
);

/** GET /analytics/summary?days=7 — the numbers the issue asks for, plus event counts. */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const raw = Number(req.query.days ?? 7);
    const days = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), EVENT_RETENTION_DAYS) : 7;
    res.json({
      ...(await productEventRepository.summary(days)),
      retentionDays: EVENT_RETENTION_DAYS,
      collectionEnabled: analyticsEnabled(),
    });
  }),
);

export default router;
