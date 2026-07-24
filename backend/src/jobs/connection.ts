import IORedis from 'ioredis';
import { env } from '../config';

/** BullMQ requires maxRetriesPerRequest=null on the shared connection. */
export const createRedisConnection = (): IORedis =>
  new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
