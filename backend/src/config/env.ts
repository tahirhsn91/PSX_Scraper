import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  SCRAPER_TIMEOUT: z.coerce.number().int().positive().default(30000),
  SCRAPER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  SCRAPER_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
  CRON_EXPRESSION: z.string().default('0 * * * *'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
  SEARCH_CACHE_TTL: z.coerce.number().int().nonnegative().default(45),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  // Hard ceiling on puppeteer.launch(). Without this, a Chromium launch that
  // hangs (e.g. under-provisioned memory/CPU, as on Render's free 512MB/0.1
  // CPU instance) never resolves or rejects — it just sits there forever,
  // permanently leaking the browser pool's concurrency slot.
  BROWSER_LAUNCH_TIMEOUT: z.coerce.number().int().positive().default(20000),
  // Express `trust proxy` setting. '1' (default) = trust exactly one hop, which
  // matches every deployment target this app uses (Render's edge, Vercel's
  // edge for the frontend only, or no proxy at all locally). Accepts a number
  // of hops, 'true'/'false', or an Express-recognized string like 'loopback'.
  // Needed so express-rate-limit can read the real client IP from
  // X-Forwarded-For instead of throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
  TRUST_PROXY: z.string().default('1'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
