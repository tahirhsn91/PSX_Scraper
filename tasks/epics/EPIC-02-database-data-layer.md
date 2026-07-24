# EPIC-02 — Database & Data Layer

**Priority:** P0 · **Total points:** 32 · **Depends on:** EPIC-01

## Goal
Model the domain in PostgreSQL via Prisma, provide migration-based versioning, and expose a clean Repository layer so services never touch the ORM directly. Includes indexing strategy for search and history queries, and seed/migration tooling.

---

## STORY-02.1 — Prisma setup & connection management
**Points:** 3 · **Priority:** P0 · **Depends on:** EPIC-01

**Acceptance Criteria**
- Prisma initialized against `DATABASE_URL`; a single `PrismaClient` singleton is shared (no per-request instantiation).
- Connection pooling configured; graceful shutdown disconnects the client.
- `prisma migrate dev` and `prisma migrate deploy` scripts work against the compose Postgres.

**Tasks**
- [ ] Install and init Prisma; add `database/prisma.ts` singleton with logging hooks.
- [ ] Add migrate/generate/studio npm scripts.
- [ ] Wire graceful shutdown (SIGINT/SIGTERM → `$disconnect`).

**Technical Notes:** For serverless-style scaling later, consider PgBouncer; not required for MVP single-primary.

---

## STORY-02.2 — Core schema: Stocks & Stock Prices
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-02.1

**Acceptance Criteria**
- `Stock` model: `id, symbol (unique), company_name, sector, created_at, updated_at`.
- `StockPrice` model: `id, stock_id (FK), current_price, change, change_percent, volume, high, low, open, close, market_cap, last_trade_date, created_at`.
- Monetary/decimal fields use `Decimal` (not float); `symbol` is uppercased-unique.
- FK `on delete cascade` from prices → stock.

**Tasks**
- [ ] Define `Stock` and `StockPrice` models with correct scalar types.
- [ ] Add unique constraint on `Stock.symbol` and FK cascade.
- [ ] Generate initial migration.

**Technical Notes:** Use `Decimal` for money/ratios to avoid float drift. Store `symbol` normalized (uppercase, trimmed).

---

## STORY-02.3 — Schema: Dividends, Financials, Ratios
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-02.2

**Acceptance Criteria**
- `Dividend`: `id, stock_id, announcement_date, book_closure, payment_date, dividend, created_at`.
- `Financial`: `id, stock_id, year, quarter, eps, sales, profit_after_tax, assets, liabilities, equity, created_at`.
- `Ratio`: `id, stock_id, pe_ratio, pb_ratio, roe, roa, dividend_yield, beta, created_at`.
- Natural uniqueness enforced to prevent duplicates (e.g. `Financial` unique on `(stock_id, year, quarter)`; `Dividend` on `(stock_id, announcement_date)`).

**Tasks**
- [ ] Define the three models with `Decimal` numeric fields and FK cascade.
- [ ] Add composite unique constraints for idempotent upserts.
- [ ] Generate migration.

**Technical Notes:** Upsert semantics depend on these unique keys — coordinate with EPIC-03 persistence (STORY-03.6).

---

## STORY-02.4 — Schema: Sync Logs
**Points:** 3 · **Priority:** P0 · **Depends on:** STORY-02.2

**Acceptance Criteria**
- `SyncLog`: `id, stock_id (nullable for sync-all), status (enum), started_at, completed_at, duration, error_message`.
- `status` is an enum (`PENDING, RUNNING, SUCCESS, PARTIAL, FAILED`).
- Indexed on `(stock_id, started_at desc)` for the logs view.

**Tasks**
- [ ] Define `SyncLog` model + `SyncStatus` enum.
- [ ] Add index for log retrieval ordering.
- [ ] Generate migration.

**Technical Notes:** `stock_id` nullable so `sync/all` runs can log an aggregate record.

---

## STORY-02.5 — Indexing & query-performance strategy
**Points:** 5 · **Priority:** P1 · **Depends on:** STORY-02.3, STORY-02.4

**Acceptance Criteria**
- Index on `Stock.symbol` (unique already) and a trigram / `ILIKE`-friendly index for partial symbol/company search.
- Index on `StockPrice(stock_id, last_trade_date desc)` for latest-price and history queries.
- `EXPLAIN ANALYZE` documented for the search query and the history query showing index usage.

**Tasks**
- [ ] Add `pg_trgm` extension migration + GIN index on `company_name`/`symbol` for fuzzy search.
- [ ] Add composite indexes for latest-price and history lookups.
- [ ] Capture EXPLAIN output in a short perf note.

**Technical Notes:** `pg_trgm` supports the fuzzy search the user has domain experience with; enables `similarity()` ranking in EPIC-06 search.

---

## STORY-02.6 — Repository layer
**Points:** 8 · **Priority:** P0 · **Depends on:** STORY-02.3, STORY-02.4

**Acceptance Criteria**
- One repository per aggregate (`StockRepository`, `PriceRepository`, `DividendRepository`, `FinancialRepository`, `RatioRepository`, `SyncLogRepository`).
- Repositories expose intent-revealing methods (`findBySymbol`, `upsertLatestPrice`, `bulkUpsertFinancials`, `createSyncLog`, `completeSyncLog`) — no Prisma types leak past the boundary; they return domain/DTO types.
- All multi-table writes for a single scrape run inside a transaction.
- Repositories are interface-typed to allow mocking in tests.

**Tasks**
- [ ] Define repository interfaces in `types/` and concrete Prisma implementations in `repositories/`.
- [ ] Implement upsert methods aligned to the unique constraints from STORY-02.3.
- [ ] Add a transactional `persistScrapeResult` helper (or unit-of-work) used by the scraper persistence step.
- [ ] Add DI wiring (simple container or factory) so services receive repositories.

**Technical Notes:** Repository Pattern is explicit in requirements. Keep Prisma inside this layer only; services depend on interfaces.

---

## STORY-02.7 — Seed & migration workflow
**Points:** 3 · **Priority:** P2 · **Depends on:** STORY-02.6

**Acceptance Criteria**
- A seed script inserts a handful of known PSX symbols (e.g. FFC, OGDC, HBL) for local dev.
- Migration runbook documented (dev vs deploy); `migrate deploy` runs automatically on backend/worker container start or via an init step.
- Rollback/repair guidance noted.

**Tasks**
- [ ] Write `prisma/seed.ts` and hook `prisma db seed`.
- [ ] Add an entrypoint step running `migrate deploy` before app start.
- [ ] Document the workflow in the deployment guide (link to EPIC-10).

**Technical Notes:** The user works with Flyway-style versioning elsewhere; Prisma Migrate is the analog here — keep migrations committed and forward-only in prod.

---

## Epic-level risks & open questions
- **Open question:** Do we retain full price history per scrape (append-only `StockPrice` rows) or keep only latest + a separate history table? Assumption: append-only rows, latest derived by `max(last_trade_date)`.
- **Risk:** Provider data may omit fields (e.g. sector, some ratios) — schema nullable where sources are unreliable; validate before insert (EPIC-03).
- **Dependency:** Unique constraints here define upsert idempotency for scrapers (EPIC-03) and job de-duplication (EPIC-05).
