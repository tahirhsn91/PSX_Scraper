import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../services/cache';

/** Redis-backed limiter so limits hold across replicas. Applied to scrape-triggering routes. */
export const mutationLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: new RedisStore({ sendCommand: (...args: string[]) => (redis as any).call(...args) }),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});
