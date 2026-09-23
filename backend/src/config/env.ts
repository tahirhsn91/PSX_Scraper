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
  // Live-quote poll: refreshes price / change% for every tracked symbol over plain HTTP
  // (no Chromium), independent of the heavy CRON_EXPRESSION sync. See jobs/scheduler.ts
  // and workers/quoteProcessor.ts.
  // Every 5 minutes, not every minute: the site's edge started refusing our data paths
  // after sustained one-minute polling (see #27), and the payload only moves when the
  // exchange prints a new trade. See the scheduler for the market-hours guard.
  // The index board is one page fetch for every index PSX publishes (see
  // services/indexScrape.service.ts), so it is a light interval rather than a queue job.
  INDEX_SCRAPE_INTERVAL_MS: z.coerce.number().int().positive().default(300000),
  INDEX_SCRAPE_MARKET_HOURS_ONLY: z.coerce.boolean().default(true),
  // NOTE: not z.coerce.boolean() — that maps the string "false" to true.
  DAILY_BOARD_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Hour of the daily board pass, in Karachi time. */
  DAILY_BOARD_HOUR: z.coerce.number().int().min(0).max(23).default(2),

  // The poll ticks every minute: the market-wide ticker is one request and the per-symbol leg
  // below is capped, so a tick costs ~30 requests and no browser — the dashboard shows the market
  // as it moves without a Chromium pass.
  QUOTE_POLL_CRON: z.string().default('*/1 * * * *'),
  QUOTE_POLL_CONCURRENCY: z.coerce.number().int().positive().default(5),
  QUOTE_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // The DPS leg fans out one request per symbol (~508 when it answers), which is the load that
  // earned the refusal in #27. It keeps its own slower interval so the tighter tick cadence
  // cannot re-earn it: on a tick where it is not due, the ticker + per-symbol legs serve the
  // board instead.
  QUOTE_POLL_DPS_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(300000),
  // Rail on the per-symbol leg, and its slice size. The ticker is the bulk path; this leg only
  // covers what the ticker omits (ETFs, preference shares, renamed tickers — ~35 symbols), and
  // that host throttles: measured 2026-09-23 at ~36 requests a minute it starts answering 429,
  // which left a third of the tail unrefreshed every tick. So the tail is walked a slice per
  // tick and wraps, covering all of it over a few minutes at a rate the host does not refuse.
  SARMAYA_QUOTE_MAX_SYMBOLS: z.coerce.number().int().nonnegative().default(12),
  // Outside the PSX session the series returns the values it already returned, so polling
  // there is load for no new data. `false` polls around the clock.
  // NOTE: not z.coerce.boolean() — that maps the string "false" to true.
  QUOTE_POLL_MARKET_HOURS_ONLY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Universe worker (#41): walk every PSX-listed security, one symbol at a time, and verify each
  // value before writing it. Off by default — a full pass is ~500 page fetches, so enabling it is
  // a deliberate decision rather than a side effect of deploying.
  // NOTE: not z.coerce.boolean() — that maps the string "false" to true.
  UNIVERSE_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // The cron only *offers* a pass; the runner decides from the clock whether it is an in-hours
  // pass, the once-per-session closing pass, or nothing at all. Keeping the pattern frequent and
  // timezone-independent means a pass starts as soon as the previous one drains (never idle).
  UNIVERSE_PASS_CRON: z.string().default('*/3 * * * *'),
  // Delay between consecutive symbols inside a pass. Politeness: the source started refusing us
  // after sustained one-minute polling (#27), and a pass is ~500 fetches.
  UNIVERSE_PACING_MS: z.coerce.number().int().positive().default(1500),
  // A quote older than this many days is not a live listing (delisted pages outlive the
  // listing). 4 days covers a weekend plus a market holiday.
  UNIVERSE_MAX_QUOTE_AGE_DAYS: z.coerce.number().int().positive().default(4),
  // Reject a volume above this multiple of the symbol's own recent median volume.
  UNIVERSE_MAX_VOLUME_MULTIPLE: z.coerce.number().positive().default(100),
  UNIVERSE_SITEMAP_URL: z.string().default('https://sarmaaya.pk/sitemap.xml'),
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
