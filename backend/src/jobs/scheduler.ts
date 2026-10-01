import { env } from "../config";
import { logger } from "../utils/logger";
import {
  syncAllQueue,
  indexQueue,
  INDEX_BOARD_JOB,
  INDEX_CONTRIBUTION_JOB,
  quoteQueue,
  enqueueIndexSync,
  QUOTE_POLL_JOB,
  KSE100_MEMBERSHIP_JOB,
  MARKET_CAP_JOB,
  SESSION_CANDLE_JOB,
  UNIVERSE_PASS_JOB,
  universeQueue,
} from "./queues";
import { indexRepository } from "../repositories/index.repository";

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
    if (job.name !== QUOTE_POLL_JOB || job.pattern === env.QUOTE_POLL_CRON)
      continue;
    await quoteQueue.removeRepeatableByKey(job.key);
    logger.info("scheduler.quote_poll_pattern_replaced", {
      was: job.pattern,
      now: env.QUOTE_POLL_CRON,
    });
  }

  await quoteQueue.add(
    QUOTE_POLL_JOB,
    { trigger: "cron" },
    { repeat: { pattern: env.QUOTE_POLL_CRON }, jobId: "scheduled-quote-poll" },
  );
  logger.info("scheduler.quote_poll_registered", {
    cron: env.QUOTE_POLL_CRON,
    marketHoursOnly: env.QUOTE_POLL_MARKET_HOURS_ONLY,
    concurrency: env.QUOTE_POLL_CONCURRENCY,
  });
}

/**
 * Register the KSE-100 membership pass.
 *
 * page one of the dashboard is the index's member list, so this has to run without being asked
 * for: the index rebalances twice a year and nothing on this side can notice that on its own. One
 * request a day (~0.6s), on its own pattern, and the pattern is reconciled the same way the poll's
 * is — BullMQ keys a repeatable by pattern, so a changed cron would otherwise tick on both.
 */
async function registerKse100MembershipSchedule(): Promise<void> {
  if (!env.KSE100_MEMBERSHIP_ENABLED) {
    // Switched off: drop a registration left by an earlier configuration, so an upgrade that
    // disables the pass does not keep ticking.
    for (const job of await quoteQueue.getRepeatableJobs()) {
      if (job.name === KSE100_MEMBERSHIP_JOB) await quoteQueue.removeRepeatableByKey(job.key);
    }
    logger.info('scheduler.kse100_membership_disabled');
    return;
  }

  for (const job of await quoteQueue.getRepeatableJobs()) {
    if (job.name !== KSE100_MEMBERSHIP_JOB || job.pattern === env.KSE100_MEMBERSHIP_CRON) continue;
    await quoteQueue.removeRepeatableByKey(job.key);
    logger.info('scheduler.kse100_membership_pattern_replaced', {
      was: job.pattern,
      now: env.KSE100_MEMBERSHIP_CRON,
    });
  }

  await quoteQueue.add(
    KSE100_MEMBERSHIP_JOB,
    { trigger: 'cron' },
    { repeat: { pattern: env.KSE100_MEMBERSHIP_CRON }, jobId: 'scheduled-kse100-membership' },
  );
  logger.info('scheduler.kse100_membership_registered', { cron: env.KSE100_MEMBERSHIP_CRON });
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
/**
 * The index board tick.
 *
 * `INDEX_SCRAPE_INTERVAL_MS` (default 300000) is the cadence the board pass was written against; a
 * repeatable job asks in cron, so this is that interval as the nearest minute step. The tick is
 * cheap when it should do nothing — one Redis call to be told the closing pass is not due yet.
 */
const INDEX_BOARD_CRON = '*/5 * * * *';

async function registerIndexBoardSchedule(): Promise<void> {
  // Same re-registration discipline as the universe pass: drain the existing keys first, so a
  // pattern or payload change cannot leave the old job running beside the new one.
  for (const job of await indexQueue.getRepeatableJobs()) {
    if (job.name !== INDEX_BOARD_JOB) continue;
    await indexQueue.removeRepeatableByKey(job.key);
  }
  await indexQueue.add(
    INDEX_BOARD_JOB,
    { trigger: 'cron' },
    { repeat: { pattern: INDEX_BOARD_CRON }, jobId: 'scheduled-index-board' },
  );
  logger.info('scheduler.index_board_registered', { cron: INDEX_BOARD_CRON });
}

/**
 * The contribution capture tick.
 *
 * Separate from the board's tick rather than an extra job in it: the board is a once-per-session read
 * and a post-close pass, while this is a live reading. A tick every two minutes through the session is
 * what the `POINTS` column needs to be current; the env cron carries the session window so it is not
 * asking a sleeping feed for news all night.
 */
async function registerIndexContributionSchedule(): Promise<void> {
  // Same re-registration discipline as every schedule here: drain first, so a pattern change cannot
  // leave the old tick running beside the new one.
  for (const job of await indexQueue.getRepeatableJobs()) {
    if (job.name !== INDEX_CONTRIBUTION_JOB) continue;
    await indexQueue.removeRepeatableByKey(job.key);
  }
  await indexQueue.add(
    INDEX_CONTRIBUTION_JOB,
    { trigger: 'cron' },
    { repeat: { pattern: env.INDEX_CONTRIBUTION_CRON }, jobId: 'scheduled-index-contributions' },
  );
  logger.info('scheduler.index_contributions_registered', { cron: env.INDEX_CONTRIBUTION_CRON });
}

async function registerUniversePassSchedule(): Promise<void> {
  if (!env.UNIVERSE_ENABLED) {
    logger.info("scheduler.universe_pass_disabled");
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
    { kind: "auto" },
    {
      repeat: { pattern: env.UNIVERSE_PASS_CRON },
      jobId: "scheduled-universe-pass",
    },
  );
  logger.info("scheduler.universe_pass_registered", {
    cron: env.UNIVERSE_PASS_CRON,
    pacingMs: env.UNIVERSE_PACING_MS,
    maxQuoteAgeDays: env.UNIVERSE_MAX_QUOTE_AGE_DAYS,
  });
}

/**
 * Register the market-cap refresh.
 *
 * Same pattern reconciliation as the poll and the membership pass: BullMQ keys a repeatable by its
 * pattern, so a *changed* cron would otherwise tick on both the old and the new schedule. Its own
 * pattern because its cost profile differs — ~150 requests for the whole book, against one for the
 * ticker — and because its window is the session rather than every minute of the day.
 */
async function registerSessionCandleSchedule(): Promise<void> {
  const queued = await quoteQueue.getRepeatableJobs();
  for (const job of queued) {
    if (job.name !== SESSION_CANDLE_JOB || job.pattern === env.SESSION_CANDLE_CRON) continue;
    // A changed cron must not leave the previous pattern ticking alongside the new one.
    await quoteQueue.removeRepeatableByKey(job.key);
  }
  if (!env.SESSION_CANDLE_ENABLED) {
    logger.info('scheduler.session_candle_disabled');
    return;
  }
  const existing = queued.find((j) => j.name === SESSION_CANDLE_JOB && j.pattern === env.SESSION_CANDLE_CRON);
  if (!existing) {
    await quoteQueue.add(
      SESSION_CANDLE_JOB,
      { trigger: 'cron' },
      { repeat: { pattern: env.SESSION_CANDLE_CRON }, jobId: 'scheduled-session-candle' },
    );
  }
  logger.info('scheduler.session_candle_registered', { cron: env.SESSION_CANDLE_CRON });
}

async function registerMarketCapSchedule(): Promise<void> {
  if (!env.MARKET_CAP_REFRESH_ENABLED) {
    // Switched off: drop a registration left by an earlier configuration, so an upgrade that
    // disables the refresh does not keep ticking.
    for (const job of await quoteQueue.getRepeatableJobs()) {
      if (job.name === MARKET_CAP_JOB) await quoteQueue.removeRepeatableByKey(job.key);
    }
    logger.info('scheduler.market_cap_disabled');
    return;
  }

  for (const job of await quoteQueue.getRepeatableJobs()) {
    if (job.name !== MARKET_CAP_JOB || job.pattern === env.MARKET_CAP_REFRESH_CRON) continue;
    await quoteQueue.removeRepeatableByKey(job.key);
    logger.info('scheduler.market_cap_pattern_replaced', {
      was: job.pattern,
      now: env.MARKET_CAP_REFRESH_CRON,
    });
  }

  await quoteQueue.add(
    MARKET_CAP_JOB,
    { trigger: 'cron' },
    { repeat: { pattern: env.MARKET_CAP_REFRESH_CRON }, jobId: 'scheduled-market-cap-refresh' },
  );
  logger.info('scheduler.market_cap_registered', { cron: env.MARKET_CAP_REFRESH_CRON });
}

export async function registerScheduler(): Promise<void> {
  await registerQuotePollSchedule();
  await registerKse100MembershipSchedule();
  await registerMarketCapSchedule();
  await registerSessionCandleSchedule();
  await registerUniversePassSchedule();
  await registerIndexBoardSchedule();
  await registerIndexContributionSchedule();

  await syncAllQueue.add(
    "scheduled-sync-all",
    { trigger: "cron" },
    { repeat: { pattern: env.CRON_EXPRESSION }, jobId: "scheduled-sync-all" },
  );
  logger.info("scheduler.registered", { cron: env.CRON_EXPRESSION });

  const indices = await indexRepository.findAll();
  for (const index of indices) {
    await indexQueue.add(
      "index-sync",
      { symbol: index.symbol, trigger: "cron" },
      {
        repeat: { pattern: env.CRON_EXPRESSION },
        jobId: `scheduled-index-${index.symbol}`,
      },
    );
  }
  logger.info("scheduler.indices_registered", { count: indices.length });

  const stale = indices.filter(
    (i) =>
      !i.lastSyncedAt || Date.now() - i.lastSyncedAt.getTime() > INDEX_STALE_MS,
  );
  for (const index of stale) {
    await enqueueIndexSync(index.symbol, "cron");
  }
  if (stale.length) {
    logger.info("scheduler.indices_stale_enqueued", {
      symbols: stale.map((i) => i.symbol),
    });
  }
}
