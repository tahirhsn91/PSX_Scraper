# EPIC-04 — Backend API & Services

**Priority:** P0 · **Total points:** 42 · **Depends on:** EPIC-02, EPIC-03

## Goal
Expose the REST surface via Express with a clean Controller → Service → Repository separation. Controllers stay thin (HTTP only), services hold business logic, DTOs + Zod validate every boundary, and OpenAPI/Swagger documents the API. No scraping or ORM logic in controllers.

---

## STORY-04.1 — Express app, middleware & routing skeleton
**Points:** 5 · **Priority:** P0 · **Depends on:** EPIC-01

**Acceptance Criteria**
- Express app bootstraps with security (helmet), CORS, JSON body parsing, request-id, and compression middleware.
- Routes are modular (`routes/` per resource) and mounted under a versioned base path (`/api/v1`).
- A 404 handler and a centralized error-handling middleware are wired (error middleware detailed in EPIC-08).
- Health endpoint `GET /health` returns liveness + dependency readiness (db, redis).

**Tasks**
- [ ] Bootstrap Express with core middleware and request-id.
- [ ] Create modular router mounting and versioned base path.
- [ ] Add `/health` with DB + Redis pings.
- [ ] Add 404 + error-handler placeholders.

**Technical Notes:** Keep app assembly (`app.ts`) separate from server start (`server.ts`) so tests import the app without binding a port.

---

## STORY-04.2 — Validation layer (Zod) & DTOs
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-04.1

**Acceptance Criteria**
- A `validate(schema)` middleware parses/validates `body`, `params`, `query` and returns 400 with structured field errors.
- Request/response DTOs defined for every endpoint; PSX symbol validation (uppercase, alphanumeric, length) centralized.
- Validation errors follow a consistent error envelope.

**Tasks**
- [ ] Implement generic Zod validation middleware.
- [ ] Define request/response schemas per endpoint in `validators/`.
- [ ] Add a reusable `symbolSchema`.

**Technical Notes:** Zod is required by the brief. Reuse the scraper-layer DTOs where shapes overlap to avoid duplication.

---

## STORY-04.3 — Stock service & CRUD endpoints
**Points:** 8 · **Priority:** P0 · **Depends on:** STORY-04.2, EPIC-02

**Acceptance Criteria**
- `GET /stocks` (paginated list), `GET /stocks/:symbol` (detail with latest price + financials + ratios + dividends + last sync status), `DELETE /stocks/:symbol` implemented.
- `StockService` orchestrates repositories; controllers are thin.
- Detail response aggregates data from multiple repositories into one DTO.
- Proper status codes (200/404/204) and error envelopes.

**Tasks**
- [ ] Implement `StockService` (list, getBySymbol aggregate, delete).
- [ ] Implement stock controller + routes.
- [ ] Add pagination (limit/offset or cursor) to list.
- [ ] Map service output to response DTOs.

**Technical Notes:** Detail endpoint is read-heavy — assemble via repositories, consider a single service method returning the composed view model.

---

## STORY-04.4 — Add new stock endpoint (POST /stocks)
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-04.3, EPIC-03, EPIC-05

**Acceptance Criteria**
- `POST /stocks` with `{ "symbol": "FFC" }` validates the symbol, rejects duplicates (409), inserts the stock, then enqueues a full scrape job (async) rather than blocking the request on scraping.
- Response returns the created stock and a job/sync reference the client can poll.
- Invalid symbols are rejected before enqueue.

**Tasks**
- [ ] Implement `StockService.addStock` (validate → insert → enqueue sync).
- [ ] Controller + route + duplicate handling (409).
- [ ] Return job/sync id for progress polling.

**Technical Notes:** The brief says "scrape complete data" on add — do it asynchronously via BullMQ (EPIC-05) so the API stays responsive; the UI shows progress (EPIC-07). Enqueue, don't block.

---

## STORY-04.5 — On-demand sync endpoint (POST /stocks/:symbol/sync)
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-04.4, EPIC-05

**Acceptance Criteria**
- `POST /stocks/:symbol/sync` enqueues a scrape job for one stock and returns a sync/job id immediately.
- De-duplication: if a sync for the symbol is already queued/running, return the existing job rather than stacking duplicates.
- 404 if the symbol isn't tracked.

**Tasks**
- [ ] Implement `SyncService.syncOne` (enqueue with de-dupe key).
- [ ] Controller + route.
- [ ] Return job status reference.

**Technical Notes:** De-dupe key = `sync:{symbol}` (EPIC-05 STORY-05.4). Powers the "Sync Latest Data" button.

---

## STORY-04.6 — History endpoint (GET /stocks/:symbol/history)
**Points:** 3 · **Priority:** P1 · **Depends on:** STORY-04.3

**Acceptance Criteria**
- Returns historical price rows for a symbol with optional date-range and pagination.
- Uses the composite index from EPIC-02 (STORY-02.5); ordered by `last_trade_date desc`.
- 404 for unknown symbol.

**Tasks**
- [ ] Implement `PriceService.getHistory(symbol, range, page)`.
- [ ] Controller + route + query validation.

**Technical Notes:** Keep response lean; support `from`/`to`/`limit`. This backs any charting on the detail page.

---

## STORY-04.7 — Sync status & logs endpoints
**Points:** 3 · **Priority:** P1 · **Depends on:** STORY-04.1, EPIC-05

**Acceptance Criteria**
- `POST /sync/all` triggers a full re-sync of all tracked stocks (enqueues the sync-all flow), returns an aggregate job reference.
- `GET /sync/status` reports current queue/job state (active, waiting, completed, failed counts + in-flight symbols).
- `GET /sync/logs` returns paginated `SyncLog` history with filters (status, symbol, date).

**Tasks**
- [ ] Implement `SyncService.syncAll`, `getStatus`, `getLogs`.
- [ ] Controllers + routes + query validation.
- [ ] Surface BullMQ queue metrics in status.

**Technical Notes:** `getStatus` reads live queue counts from BullMQ; `getLogs` reads persisted `SyncLog` rows.

---

## STORY-04.8 — OpenAPI / Swagger documentation
**Points:** 5 · **Priority:** P1 · **Depends on:** STORY-04.3–04.7

**Acceptance Criteria**
- OpenAPI spec generated (from Zod schemas where feasible) and served at `/api/docs` (Swagger UI).
- Every endpoint documents params, request/response schemas, and error responses.
- Spec is exportable as a static file for the docs deliverable (EPIC-10).

**Tasks**
- [ ] Generate OpenAPI from Zod (`zod-to-openapi`) or maintain an annotated spec.
- [ ] Mount Swagger UI at `/api/docs`.
- [ ] Export `openapi.json` for documentation.

**Technical Notes:** `@asteasolutions/zod-to-openapi` keeps a single source of truth between validation and docs.

---

## STORY-04.9 — API-level rate limiting & hardening
**Points:** 3 · **Priority:** P2 · **Depends on:** STORY-04.1

**Acceptance Criteria**
- Basic rate limiting on mutating endpoints (add/sync) to prevent abuse of scrape triggers.
- Payload size limits and standard security headers verified.
- Consistent error envelope across all failures.

**Tasks**
- [ ] Add `express-rate-limit` (Redis-backed) on sync/add routes.
- [ ] Verify helmet config + body size limits.

**Technical Notes:** Redis-backed limiter so limits hold across multiple backend replicas.

---

## Epic-level risks & open questions
- **Open question:** Is `POST /stocks` expected to return synchronously with scraped data, or accept-and-enqueue? Assumption: **enqueue** (async) for responsiveness; documented in STORY-04.4.
- **Risk:** Detail endpoint N+1 across repositories — compose with batched reads or a single service method.
- **Dependency:** Sync/add endpoints depend on EPIC-05 queues; stub the queue interface so EPIC-04 can progress in parallel with EPIC-05.
