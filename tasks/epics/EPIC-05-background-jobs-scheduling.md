# EPIC-05 — Background Jobs & Scheduling

**Priority:** P0 · **Total points:** 34 · **Depends on:** EPIC-02, EPIC-03

## Goal
Move all scraping off the request path into BullMQ-backed background jobs processed by a dedicated worker. Provide an hourly scheduler for full syncs, per-stock on-demand jobs, retry with exponential backoff, job de-duplication, and observable job state.

---

## STORY-05.1 — BullMQ + Redis infrastructure
**Points:** 5 · **Priority:** P0 · **Depends on:** EPIC-01

**Acceptance Criteria**
- Redis connection is shared/configured via `REDIS_URL`; separate connections for queue and worker as BullMQ requires.
- Two queues defined: `stock-sync` (single symbol) and `stock-sync-all` (fan-out).
- Queue/worker modules live in `jobs/` and `workers/` respectively; clean shutdown drains in-flight jobs.

**Tasks**
- [ ] Set up Redis connection factory (separate connections for producer/worker).
- [ ] Define `stock-sync` and `stock-sync-all` queues + typed job payloads.
- [ ] Implement graceful worker shutdown (SIGTERM → close after in-flight completes).

**Technical Notes:** BullMQ needs distinct ioredis connections for `Queue` vs `Worker`. Payloads typed in `types/`.

---

## STORY-05.2 — Sync worker (single-stock processor)
**Points:** 8 · **Priority:** P0 · **Depends on:** STORY-05.1, EPIC-03

**Acceptance Criteria**
- Worker consumes `stock-sync` jobs, invokes the scrape orchestrator + persistence (EPIC-03), and writes the `SyncLog` lifecycle.
- Job progress is reported (e.g. 0→scraping→persisting→100) so the API/UI can poll.
- Concurrency is configurable; total scrape load stays within scraper limits (EPIC-03 STORY-03.8).
- Job result/return value carries a summary (provider outcomes, counts).

**Tasks**
- [ ] Implement `stock-sync` worker processor calling orchestrator + persist.
- [ ] Emit `job.updateProgress` at each stage.
- [ ] Bound worker concurrency via config; align with scraper concurrency.
- [ ] Return structured job result.

**Technical Notes:** Worker runs in its own container/image (EPIC-01 STORY-01.4) with Chromium deps. Keep the backend API container Puppeteer-free.

---

## STORY-05.3 — Sync-all fan-out flow
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-05.2

**Acceptance Criteria**
- A `stock-sync-all` job enumerates all tracked stocks and enqueues one `stock-sync` job per symbol (fan-out), respecting concurrency.
- An aggregate `SyncLog` (nullable stock_id) records the batch outcome (total, succeeded, failed, partial).
- Fan-out is idempotent — re-triggering while a batch runs doesn't double-enqueue (de-dupe per symbol).

**Tasks**
- [ ] Implement fan-out processor (read all symbols → enqueue child jobs).
- [ ] Aggregate child outcomes into a batch summary log.
- [ ] Apply per-symbol de-dupe on fan-out.

**Technical Notes:** Consider BullMQ Flows/parent-child for aggregate completion tracking, or track counts via the batch SyncLog.

---

## STORY-05.4 — Job de-duplication & idempotency
**Points:** 3 · **Priority:** P0 · **Depends on:** STORY-05.1

**Acceptance Criteria**
- Enqueuing a sync for a symbol already queued/active reuses the existing job (stable `jobId = sync:{symbol}`), preventing duplicate concurrent scrapes.
- Completed jobs are removed/kept per a configured retention so re-syncs are allowed later.

**Tasks**
- [ ] Use deterministic `jobId` per symbol + `removeOnComplete`/`removeOnFail` retention config.
- [ ] Add a helper the API uses to check/return an existing job.

**Technical Notes:** Backs the de-dupe requirement in EPIC-04 STORY-04.5. Prevents the "Sync" button and the hourly cron from colliding.

---

## STORY-05.5 — Hourly scheduler (configurable cron)
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-05.3

**Acceptance Criteria**
- A repeatable job triggers `stock-sync-all` on the schedule from `CRON_EXPRESSION` (default hourly).
- The schedule is configurable without code changes; only one scheduler instance runs even with multiple workers (no duplicate cron).
- Cron executions are logged (start/finish/outcome).

**Tasks**
- [ ] Register a BullMQ repeatable job from `CRON_EXPRESSION`.
- [ ] Guard against duplicate schedulers across replicas (repeatable jobs are Redis-deduped by key — verify).
- [ ] Log each cron trigger (EPIC-08).

**Technical Notes:** BullMQ repeatable jobs are keyed and Redis-deduplicated, so multiple worker replicas won't create duplicate schedules — verify and document.

---

## STORY-05.6 — Retry policy & exponential backoff
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-05.2

**Acceptance Criteria**
- Jobs use 3 attempts with exponential backoff (per the brief).
- Backoff distinguishes transient (retry) from permanent (`InvalidSymbolError` → fail fast, no retry) using the scraper error taxonomy (EPIC-03 STORY-03.7).
- Exhausted jobs land in a failed state with the final error persisted to `SyncLog`; a dead-letter view is queryable via `GET /sync/logs`.

**Tasks**
- [ ] Configure `attempts: 3` + exponential `backoff` on both queues.
- [ ] Implement a custom backoff/`UnrecoverableError` path for permanent errors.
- [ ] Persist final failure to SyncLog and expose via logs endpoint.

**Technical Notes:** Use BullMQ `UnrecoverableError` to short-circuit retries for invalid symbols. Coordinate attempt counts with in-scraper retries so total attempts stay reasonable.

---

## STORY-05.7 — Queue observability hooks
**Points:** 3 · **Priority:** P2 · **Depends on:** STORY-05.2

**Acceptance Criteria**
- Queue events (completed, failed, stalled) are logged with context (EPIC-08).
- Live counts (waiting/active/completed/failed/delayed) are exposed for `GET /sync/status`.
- Optional: a Bull Board dashboard is mountable in non-prod for debugging.

**Tasks**
- [ ] Wire QueueEvents listeners → logger.
- [ ] Expose count aggregation used by the status endpoint.
- [ ] (Optional) mount Bull Board behind a dev flag.

**Technical Notes:** Feeds EPIC-04 STORY-04.7 status endpoint. Keep Bull Board dev-only unless auth is added.

---

## Epic-level risks & open questions
- **Risk:** Compounding retries (in-scraper + BullMQ) cause excessive load on source sites — cap and document total attempts.
- **Risk:** Fan-out of many symbols hourly could saturate the browser pool — throttle child enqueue rate / worker concurrency.
- **Open question:** Should sync-all be a single fan-out per hour, or staggered batches? Assumption: fan-out with bounded worker concurrency; revisit if source rate-limits.
- **Dependency:** Requires EPIC-03 persistence (STORY-03.6) and error taxonomy (STORY-03.7).
