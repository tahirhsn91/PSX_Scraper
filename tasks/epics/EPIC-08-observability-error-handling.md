# EPIC-08 — Observability & Error Handling

**Priority:** P1 · **Total points:** 21 · **Depends on:** EPIC-01, EPIC-04

## Goal
Provide structured logging (Winston), consistent error handling across the API and workers, and performance metrics — covering API requests, scraping, cron executions, errors, and timing. Failures are diagnosable and the system's health is observable.

---

## STORY-08.1 — Winston structured logging foundation
**Points:** 5 · **Priority:** P1 · **Depends on:** EPIC-01

**Acceptance Criteria**
- A shared Winston logger with JSON output, levels from `LOG_LEVEL`, timestamps, and service/context metadata.
- Console transport (dev) + file/stdout (prod); correlation via request-id/job-id.
- Secrets are never logged; log shape is consistent across backend and worker.

**Tasks**
- [ ] Implement `utils/logger.ts` (Winston) with env-driven level + JSON format.
- [ ] Add child-logger helper for per-request / per-job context.
- [ ] Redact sensitive fields.

**Technical Notes:** JSON logs so they're ingestible by any aggregator later. Child loggers carry `requestId`/`jobId`/`symbol`.

---

## STORY-08.2 — HTTP request/response logging & correlation
**Points:** 3 · **Priority:** P1 · **Depends on:** STORY-08.1, EPIC-04

**Acceptance Criteria**
- Middleware logs each request (method, path, status, latency) with a correlation id propagated end-to-end.
- Slow requests flagged; noisy health checks are excluded or sampled.

**Tasks**
- [ ] Add request-logging middleware bound to the Winston child logger.
- [ ] Generate/propagate request-id (header in/out).
- [ ] Threshold-log slow requests.

**Technical Notes:** Correlation id links API → enqueued job → worker logs for a full trace of a sync.

---

## STORY-08.3 — Global API error-handling middleware
**Points:** 5 · **Priority:** P0 · **Depends on:** EPIC-04 (STORY-04.1)

**Acceptance Criteria**
- A single error middleware maps known error types (validation, not-found, conflict, scraper errors, DB errors) to correct status codes and a consistent error envelope `{ error: { code, message, details, requestId } }`.
- Unhandled errors return 500 without leaking internals; full detail is logged.
- Async route errors are captured (wrapper/`express-async-errors`).

**Tasks**
- [ ] Define an `AppError` hierarchy + HTTP mapping.
- [ ] Implement the centralized error middleware + async error capture.
- [ ] Standardize the error envelope consumed by the frontend (EPIC-07).

**Technical Notes:** The envelope is the contract for EPIC-07 STORY-07.9. Map EPIC-03 scraper errors + Prisma known errors explicitly.

---

## STORY-08.4 — Scraping, cron & job logging
**Points:** 3 · **Priority:** P1 · **Depends on:** STORY-08.1, EPIC-03, EPIC-05

**Acceptance Criteria**
- Each scrape logs start/finish, provider outcomes, duration, and parse failures (with selector context from EPIC-03).
- Cron triggers and job lifecycle events (completed/failed/stalled) are logged with correlation ids.
- Parse-failure logs are distinguishable for alerting (source markup drift).

**Tasks**
- [ ] Instrument the scrape orchestrator + persistence with structured logs.
- [ ] Hook BullMQ QueueEvents + cron triggers into the logger.
- [ ] Tag parse failures for easy filtering/alerting.

**Technical Notes:** Parse-failure signal is the early-warning system for source HTML drift (EPIC-03 top risk).

---

## STORY-08.5 — Performance metrics & health
**Points:** 5 · **Priority:** P2 · **Depends on:** STORY-08.1, EPIC-04

**Acceptance Criteria**
- Key metrics captured: API latency, scrape duration per provider, job throughput/failure rate, queue depth.
- Metrics exposed (e.g. `/metrics` Prometheus format) or at minimum logged as structured performance events.
- `/health` reflects DB + Redis readiness (from EPIC-04 STORY-04.1) and basic worker liveness.

**Tasks**
- [ ] Add timing instrumentation (API, scrape, job) as metrics/events.
- [ ] Expose `/metrics` (prom-client) or structured perf logs.
- [ ] Extend health to include worker/queue signals.

**Technical Notes:** `prom-client` is low-cost and future-proofs dashboards; if out of scope, fall back to structured performance log events.

---

## Epic-level risks & open questions
- **Open question:** Is a metrics backend (Prometheus/Grafana) in scope for MVP, or are structured perf logs sufficient? Assumption: structured logs for MVP, `/metrics` endpoint provided but dashboards deferred.
- **Risk:** Over-logging in the hourly fan-out could be noisy/costly — use levels + sampling.
- **Dependency:** Error envelope (STORY-08.3) is a hard dependency for the frontend error UX.
