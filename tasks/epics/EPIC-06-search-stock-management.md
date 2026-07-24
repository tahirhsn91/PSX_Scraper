# EPIC-06 — Search & Stock Management

**Priority:** P1 · **Total points:** 26 · **Depends on:** EPIC-04, EPIC-05

## Goal
Deliver the search experience and the stock lifecycle features as cohesive product capabilities on top of the API: fast (cached, fuzzy) symbol/company search, add/remove tracked stocks, and on-demand sync with progress — all requirements the user experiences directly.

---

## STORY-06.1 — Search API with fuzzy matching
**As a** user **I want** to search stocks by symbol or company **so that** I can find and open a stock quickly.
**Points:** 8 · **Priority:** P1 · **Depends on:** EPIC-04, EPIC-02 (STORY-02.5)

**Acceptance Criteria**
- `GET /search?q=FFC` returns matches with symbol, company name, current price, latest synced date, and last trade date.
- Matching is fuzzy/partial (leveraging `pg_trgm`) and ranked by similarity; exact-symbol matches rank first.
- Handles empty/short queries gracefully; results are paginated/limited.

**Tasks**
- [ ] Implement `SearchService` using trigram similarity + ranking.
- [ ] Compose result DTO (symbol, company, price, lastSynced, lastTradeDate).
- [ ] Controller + route + query validation.
- [ ] Handle min-length and empty-query behavior.

**Technical Notes:** The user has fuzzy/phonetic search domain experience — `pg_trgm` similarity covers fuzzy; phonetic (e.g. `dmetaphone`) is an optional enhancement noted below.

---

## STORY-06.2 — Search result caching
**Points:** 5 · **Priority:** P1 · **Depends on:** STORY-06.1

**Acceptance Criteria**
- Search responses are cached in Redis with a short TTL keyed by normalized query.
- Cache is invalidated (or naturally expires) when underlying prices sync so results don't go too stale.
- Cache hit/miss is observable in logs/metrics.

**Tasks**
- [ ] Add Redis cache-aside around `SearchService`.
- [ ] Key normalization + TTL config; instrument hit/miss.
- [ ] Define invalidation/expiry strategy relative to sync cadence.

**Technical Notes:** Requirement explicitly calls for cached search. Short TTL (e.g. 30–60s) balances freshness vs load; prices change on sync, not per-second.

---

## STORY-06.3 — Add stock capability (end-to-end)
**Points:** 3 · **Priority:** P1 · **Depends on:** EPIC-04 (STORY-04.4), EPIC-05

**Acceptance Criteria**
- Adding a symbol validates it, persists the stock, kicks off a full scrape, and the new stock becomes searchable once the first sync completes.
- Duplicate adds are rejected with a clear message.
- The add flow returns a reference the UI can poll to show progress.

**Tasks**
- [ ] Verify the add → enqueue → first-sync → searchable path end-to-end.
- [ ] Confirm duplicate handling and progress reference.

**Technical Notes:** Mostly integration/verification over EPIC-04 + EPIC-05; kept as a distinct product story for traceability.

---

## STORY-06.4 — Remove stock capability
**Points:** 2 · **Priority:** P2 · **Depends on:** EPIC-04 (STORY-04.3)

**Acceptance Criteria**
- Deleting a symbol removes the stock and cascades related prices/financials/ratios/dividends/logs (or soft-deletes per decision).
- Any scheduled/queued jobs for the symbol are cancelled or safely no-op.
- Search no longer returns the removed stock.

**Tasks**
- [ ] Confirm cascade/soft-delete behavior aligns with EPIC-02 constraints.
- [ ] Ensure queued jobs for a deleted symbol are handled (skip/cancel).

**Technical Notes:** Decide hard vs soft delete (open question in EPIC-02). If hard delete, ensure in-flight jobs handle a missing stock gracefully.

---

## STORY-06.5 — On-demand sync with progress
**Points:** 5 · **Priority:** P1 · **Depends on:** EPIC-04 (STORY-04.5), EPIC-05 (STORY-05.2)

**Acceptance Criteria**
- Triggering a manual sync for a symbol starts scraping immediately (subject to de-dupe), and progress is queryable until completion.
- On completion, the freshest data + last-sync status are retrievable for the UI to refresh.
- Concurrent manual triggers for the same symbol don't stack.

**Tasks**
- [ ] Expose job progress via a status lookup (job id or `GET /sync/status` filtered by symbol).
- [ ] Verify de-dupe + refresh-on-complete behavior end-to-end.

**Technical Notes:** Powers the "Sync Latest Data" button (EPIC-07 STORY-07.3). Progress comes from BullMQ `updateProgress` (EPIC-05 STORY-05.2).

---

## STORY-06.6 — (Optional) Phonetic search enhancement
**Points:** 3 · **Priority:** P2 · **Depends on:** STORY-06.1

**Acceptance Criteria**
- Company-name search optionally matches phonetically (e.g. `dmetaphone`) to tolerate spelling variance.
- Feature is behind a flag; falls back to trigram-only if the extension is unavailable.

**Tasks**
- [ ] Add `fuzzystrmatch` extension + phonetic ranking blended with trigram score.
- [ ] Flag-gate and benchmark.

**Technical Notes:** Nice-to-have that plays to the user's phonetic-search background; not required for MVP.

---

## Epic-level risks & open questions
- **Open question:** Hard vs soft delete for stocks (shared with EPIC-02).
- **Risk:** Cache staleness vs freshness tradeoff — TTL tuning needed once real sync cadence is observed.
- **Dependency:** Search ranking quality depends on EPIC-02 indexing (STORY-02.5).
