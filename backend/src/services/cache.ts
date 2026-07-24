import IORedis from 'ioredis';
import { env } from '../config';
import { logger } from '../utils/logger';

const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (raw) {
      logger.debug('cache.hit', { key });
      return JSON.parse(raw) as T;
    }
    logger.debug('cache.miss', { key });
    return null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
  } catch {
    /* cache failures are non-fatal */
  }
}

export { redis };
