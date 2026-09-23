import { env } from '../config';
import { logger } from '../utils/logger';
import {
  syncAllQueue,
  indexQueue,
  quoteQueue,
  enqueueIndexSync,
  QUOTE_POLL_JOB,
  UNIVERSE_PASS_JOB,
  universeQueue,
} from './queues';
import { indexRepository } from '../repositories/index.repository';

/** One cron interval: an index whose last sync is older than this is treated as stale. */
const INDEX_STALE_MS = 60 * 60 * 1000;

/**
 * Register (or re-point) the quote poll schedule.
 *
 * BullMQ does not reconcile a *changed* cron pattern: adding `scheduled-quote-poll` with a new
 * pattern leaves the previously registered one — and its already-queued delayed job — sitting in
 * Redis, so the poll fires on BOTH schedules until the old chain drains. Changing the cadence is a
 * routine config change, so it has to clean up after itself: without this, moving from every
 * minute to every 5 minutes silently kept the one-minute ticks coming, which is exactly the load
 * that earned the source-side refusal in #27.
 */
async function registerQuotePollSchedule(): Promise<void> {
  const existing = await quoteQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name !== QUOTE_POLL_JOB || job.pattern === env.QUOTE_POLL_CRON) continue;
    await quoteQueue.removeRepeatableByKey(job.key);
    logger.info('scheduler.quote_poll_pattern_replaced', {
      was: job.pattern,
      now: env.QUOTE_POLL_CRON,
    });
  }

  await quoteQueue.add(
    QUOTE_POLL_JOB,
    { trigger: 'cron' },
    { repeat: { pattern: env.QUOTE_POLL_CRON }, jobId: 'scheduled-quote-poll' },
  );
  logger.info('scheduler.quote_poll_registered', {
    cron: env.QUOTE_POLL_CRON,
    marketHoursOnly: env.QUOTE_POLL_MARKET_HOURS_ONLY,
    concurrency: env.QUOTE_POLL_CONCURRENCY,
  });
}

/**
 * Register repeatable jobs:
 *  - `scheduled-quote-poll` — live price / change% for every tracked symbol, on
 *    QUOTE_POLL_CRON (default: every minute; its DPS leg runs on its own slower interval).
 *    Plain HTTP, no browser.
 *  - `scheduled-sync-all` — full stock sync on CRON_EXPRESSION.
 *  - `scheduled-index-<SYMBOL>` — one per tracked index, on the same expression.
 *
 * The quote poll is deliberately independent of CRON_EXPRESSION: prices move during the
 * session while ratios, dividends and financials do not, and running the full company-page
 * scrape that often is both unnecessary and hostile to the source.
 *
 * BullMQ dedupes repeatable jobs by key, so multiple workers won't duplicate them.
 *
 * Also fires an immediate index sync when an index has never been synced or its last
 * sync is stale. Without that, a fresh deploy (or a fresh database) serves null values
 * until the next cron tick, which is exactly when `GET /api/v1/indices/KSE100` is most
 * likely to be called.
 */
/**
 * Offer a universe pass on UNIVERSE_PASS_CRON.
 *
 * Only when the worker is enabled: a disabled feature should not leave a repeatable job ticking.
 * The pattern is deliberately frequent and timezone-independent — the runner inspects the PKT
 * clock and decides whether this is an in-hours pass, the once-per-session closing pass, or
 * nothing. That is what makes the passes never idle without a second schedule to keep in sync.
 */
async function registerUniversePassSchedule(): Promise<void> {
  if (!env.UNIVERSE_ENABLED) {
    logger.info('scheduler.universe_pass_disabled');
    return;
  }
  // Drop any existing registration first: BullMQ keys a repeatable by pattern, so a job whose
  // *data* changed (this one used to ask for intraday passes only) would otherwise keep running
  // with the old payload. Cheap and idempotent — the pass guards itself against duplicate work.
  for (const job of await universeQueue.getRepeatableJobs()) {
    if (job.name !== UNIVERSE_PASS_JOB) continue;
    await universeQueue.removeRepeatableByKey(job.key);
  }

  await universeQueue.add(
    UNIVERSE_PASS_JOB,
    { kind: 'auto' },
    { repeat: { pattern: env.UNIVERSE_PASS_CRON }, jobId: 'scheduled-universe-pass' },
  );
  logger.info('scheduler.universe_pass_registered', {
    cron: env.UNIVERSE_PASS_CRON,
    pacingMs: env.UNIVERSE_PACING_MS,
    maxQuoteAgeDays: env.UNIVERSE_MAX_QUOTE_AGE_DAYS,
  });
}

export async function registerScheduler(): Promise<void> {
  await registerQuotePollSchedule();
  await registerUniversePassSchedule();

  // With the universe worker on, the scheduled full-board sync is pure duplication: both walk
  // every symbol through the same browser-bound scraper, and with ~500 symbols one walk already
  // outlasts the hour it is scheduled for — so the queue never drains, the dashboard shows
  // "SYNCING ALL" permanently, and the two compete for the browser pool (the source of the
  // intermittent "Target closed" failures). The manual SYNC ALL button still works; only the
  // *schedule* stands down. An existing registration is removed so an upgrade does not leave it
  // ticking.
  if (env.UNIVERSE_ENABLED) {
    for (const job of await syncAllQueue.getRepeatableJobs()) {
      if (job.name !== 'scheduled-sync-all') continue;
      await syncAllQueue.removeRepeatableByKey(job.key);
    }
    logger.info('scheduler.sync_all_stood_down', { reason: 'universe worker covers the whole board' });
  } else {
    await syncAllQueue.add(
      'scheduled-sync-all',
      { trigger: 'cron' },
      { repeat: { pattern: env.CRON_EXPRESSION }, jobId: 'scheduled-sync-all' },
    );
    logger.info('scheduler.registered', { cron: env.CRON_EXPRESSION });
  }

  const indices = await indexRepository.findAll();
  for (const index of indices) {
    await indexQueue.add(
      'index-sync',
      { symbol: index.symbol, trigger: 'cron' },
      { repeat: { pattern: env.CRON_EXPRESSION }, jobId: `scheduled-index-${index.symbol}` },
    );
  }
  logger.info('scheduler.indices_registered', { count: indices.length });

  const stale = indices.filter(
    (i) => !i.lastSyncedAt || Date.now() - i.lastSyncedAt.getTime() > INDEX_STALE_MS,
  );
  for (const index of stale) {
    await enqueueIndexSync(index.symbol, 'cron');
  }
  if (stale.length) {
    logger.info('scheduler.indices_stale_enqueued', { symbols: stale.map((i) => i.symbol) });
  }
}
