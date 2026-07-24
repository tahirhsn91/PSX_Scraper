# EPIC-09 — Testing & Quality

**Priority:** P1 · **Total points:** 34 · **Depends on:** EPIC-03, EPIC-04

## Goal
Establish a Jest-based testing strategy across all layers — unit, integration, scraper, and API — with mockable boundaries, deterministic fixtures, and CI gating. Quality gates (coverage thresholds, lint, typecheck) prevent regressions.

---

## STORY-09.1 — Jest setup & test infrastructure
**Points:** 3 · **Priority:** P1 · **Depends on:** EPIC-01

**Acceptance Criteria**
- Jest configured for backend TS (ts-jest/swc), separate `unit` and `integration` projects/config.
- Coverage reporting enabled with a threshold (e.g. 70% lines to start) enforced in CI.
- Test scripts (`test`, `test:watch`, `test:integration`, `test:coverage`) wired.

**Tasks**
- [ ] Configure Jest + TS transform + coverage thresholds.
- [ ] Split unit vs integration projects.
- [ ] Add test scripts and CI wiring.

**Technical Notes:** Keep integration tests (DB/Redis) separate so unit tests stay fast and hermetic.

---

## STORY-09.2 — Unit tests: services & repositories
**Points:** 8 · **Priority:** P1 · **Depends on:** STORY-09.1, EPIC-04

**Acceptance Criteria**
- Services tested against mocked repository interfaces (no DB) covering happy paths + error branches (not found, duplicate, invalid).
- Repository methods covered where logic exists (upsert mapping, transaction composition) using Prisma mocks or a test DB.
- Validation schemas (Zod) unit-tested for accept/reject cases.

**Tasks**
- [ ] Mock repository interfaces; test each service method + branches.
- [ ] Test Zod validators (symbol, DTOs) for edge cases.
- [ ] Test repository upsert/transaction mapping.

**Technical Notes:** Interface-typed repositories (EPIC-02 STORY-02.6) make service mocking clean — the user's mocking-framework experience applies directly.

---

## STORY-09.3 — Scraper tests with fixtures
**Points:** 8 · **Priority:** P1 · **Depends on:** STORY-09.1, EPIC-03

**Acceptance Criteria**
- PSXScraper and SarmaayaScraper tested against saved HTML fixtures (no live network) verifying correct extraction → `ScrapeResult`.
- Tests cover not-found pages, missing fields, and malformed markup (→ `ParseError`).
- Orchestrator/merge precedence and partial-success paths tested.

**Tasks**
- [ ] Build a Puppeteer page-mock or DOM harness (e.g. `setContent` with fixtures) for deterministic parsing tests.
- [ ] Test extraction, not-found, and parse-failure cases per provider.
- [ ] Test orchestrator merge rules + partial success.

**Technical Notes:** Use `page.setContent(fixtureHtml)` or a jsdom-based parser seam so tests never hit the live sites. Fixtures come from EPIC-03 STORY-03.3/03.4.

---

## STORY-09.4 — API / integration tests
**Points:** 8 · **Priority:** P1 · **Depends on:** STORY-09.1, EPIC-04

**Acceptance Criteria**
- Endpoint tests (Supertest) against the assembled Express app with a test PostgreSQL (Testcontainers or a disposable schema) and mocked/queued scrape.
- Cover CRUD, add (enqueue), sync (de-dupe), search, history, and sync logs/status — including error responses and status codes.
- Scrape/queue side effects are stubbed so tests are deterministic.

**Tasks**
- [ ] Set up Supertest + ephemeral test DB (Testcontainers or migrate a temp schema).
- [ ] Write endpoint tests for each route incl. error paths.
- [ ] Stub the queue/scraper boundary for the add/sync flows.

**Technical Notes:** App/server split (EPIC-04 STORY-04.1) lets Supertest import the app without a live port. Testcontainers gives a real Postgres for trustworthy integration coverage.

---

## STORY-09.5 — Job/worker tests
**Points:** 5 · **Priority:** P2 · **Depends on:** STORY-09.1, EPIC-05

**Acceptance Criteria**
- Worker processor tested with a mocked scrape orchestrator: verifies persistence calls, SyncLog lifecycle, progress reporting, and retry/permanent-error handling.
- De-dupe and fan-out logic covered.

**Tasks**
- [ ] Unit-test the processor with mocked orchestrator + repositories.
- [ ] Test retry vs `UnrecoverableError` branching.
- [ ] Test fan-out enqueue + de-dupe.

**Technical Notes:** Test the processor function directly (pure-ish) rather than spinning a real Redis where possible; use a Redis test instance only for de-dupe/repeatable-job behavior.

---

## STORY-09.6 — Quality gates in CI
**Points:** 2 · **Priority:** P2 · **Depends on:** STORY-09.1, EPIC-01 (STORY-01.7)

**Acceptance Criteria**
- CI blocks merge on failing tests, coverage below threshold, lint errors, or type errors.
- Test results/coverage surfaced on the PR.

**Tasks**
- [ ] Wire test + coverage + lint + typecheck into the CI gate.
- [ ] Publish coverage summary artifact.

**Technical Notes:** Reuse EPIC-01 CI pipeline; add the coverage gate here.

---

## Epic-level risks & open questions
- **Risk:** Live-site scraper tests are flaky/forbidden — mandate fixture-based tests; keep at most a tiny opt-in smoke test against live sites, not in CI.
- **Open question:** Testcontainers vs shared test DB — Testcontainers preferred for isolation if CI supports Docker-in-Docker.
- **Dependency:** Scraper tests depend on fixtures produced in EPIC-03.
