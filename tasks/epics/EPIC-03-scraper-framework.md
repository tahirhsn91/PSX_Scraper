# EPIC-03 — Scraper Framework

**Priority:** P0 · **Total points:** 47 · **Depends on:** EPIC-01, EPIC-02

## Goal
Build a pluggable, provider-agnostic scraping framework on Puppeteer. Each source (PSX DPS, Sarmaaya) is an independent scraper implementing a common interface `scrape(symbol: string)`. Scraping logic lives entirely outside controllers/services-as-orchestrators, is resilient to failure, and normalizes heterogeneous source output into canonical DTOs before persistence. This is the highest-risk epic — sequence it early.

---

## STORY-03.1 — Scraper interface & pluggable registry
**As an** architect **I want** a common scraper contract and registry **so that** new providers are added without touching business logic.
**Points:** 5 · **Priority:** P0 · **Depends on:** EPIC-01

**Acceptance Criteria**
- `IStockScraper` interface defines `readonly source: string` and `scrape(symbol: string): Promise<ScrapeResult>`.
- A `ScraperRegistry` resolves enabled scrapers by name/config; adding a provider = implement interface + register (Open/Closed).
- Canonical `ScrapeResult` DTO defines normalized shape (company, price, financials[], ratios, dividends[]) independent of any source.

**Tasks**
- [ ] Define `IStockScraper` + `ScrapeResult` and sub-DTOs in `types/`.
- [ ] Implement `ScraperRegistry` with config-driven enable/disable.
- [ ] Document the "add a new provider" recipe.

**Technical Notes:** Satisfies the "pluggable scraper framework" future-extensibility requirement. Registry keyed by config so providers toggle via env.

---

## STORY-03.2 — Puppeteer browser pool & page lifecycle
**Points:** 8 · **Priority:** P0 · **Depends on:** STORY-03.1

**Acceptance Criteria**
- A shared, reusable browser instance/pool with bounded concurrency (configurable) rather than launching a browser per scrape.
- Per-scrape pages are created, isolated, and always closed (even on error).
- Sensible defaults: headless, `--no-sandbox` (container), navigation timeout from `SCRAPER_TIMEOUT`, request interception to block images/fonts/analytics for speed.
- Graceful browser shutdown on process exit.

**Tasks**
- [ ] Implement `BrowserPool` (launch, acquire page, release, drain).
- [ ] Add request interception to block non-essential resources.
- [ ] Wire timeouts and concurrency to config.
- [ ] Ensure page cleanup via `try/finally`.

**Technical Notes:** Browser launch is expensive — reuse. Concurrency limit prevents memory blowups and reduces anti-bot risk (coordinate with EPIC-05 worker concurrency).

---

## STORY-03.3 — PSXScraper (dps.psx.com.pk)
**Points:** 8 · **Priority:** P0 · **Depends on:** STORY-03.1, STORY-03.2

**Acceptance Criteria**
- `PSXScraper.scrape(symbol)` navigates to `https://dps.psx.com.pk/company/{SYMBOL}` and extracts company info, current price/OHLC/volume/market cap, and any available financials/ratios/dividends.
- Selectors are centralized in a config/map (not inline) for maintainability.
- Returns a populated `ScrapeResult`; missing fields are `null`, not fabricated.
- Handles "symbol not found" pages distinctly from transport errors.

**Tasks**
- [ ] Map DPS page DOM → selector config.
- [ ] Implement extraction + normalization to `ScrapeResult`.
- [ ] Detect and classify not-found vs error states.
- [ ] Add fixtures (saved HTML) for offline tests (feeds EPIC-09).

**Technical Notes:** DPS renders some data via async widgets — wait on specific selectors, not fixed sleeps. Verify against live `FFC` example.

---

## STORY-03.4 — SarmaayaScraper (sarmaaya.pk)
**Points:** 8 · **Priority:** P0 · **Depends on:** STORY-03.1, STORY-03.2

**Acceptance Criteria**
- `SarmaayaScraper.scrape(symbol)` navigates to `https://sarmaaya.pk/stocks/{SYMBOL}` and extracts the same canonical fields, filling gaps PSX doesn't provide (e.g. richer ratios/financials/dividends).
- Selectors centralized; output normalized to the identical `ScrapeResult` DTO.
- Not-found vs error states distinguished.

**Tasks**
- [ ] Map Sarmaaya DOM → selector config.
- [ ] Implement extraction + normalization.
- [ ] Save HTML fixtures for tests.
- [ ] Verify against live `FFC` example.

**Technical Notes:** Two providers means field-level reconciliation — define precedence rules (see STORY-03.5) rather than blind overwrite.

---

## STORY-03.5 — Multi-source orchestration & normalization
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-03.3, STORY-03.4

**Acceptance Criteria**
- A `ScrapeOrchestrator` runs the enabled scrapers for a symbol (in parallel, within concurrency limits) and merges results into one canonical `ScrapeResult` using documented field-precedence rules.
- Partial success is supported: if one provider fails, data from the other still persists and the run is marked `PARTIAL`.
- Merged output is schema-validated (Zod) before it leaves the scraper layer.

**Tasks**
- [ ] Implement orchestrator with `Promise.allSettled` across scrapers.
- [ ] Define and apply merge/precedence rules (e.g. price from PSX, ratios from Sarmaaya).
- [ ] Validate merged DTO with Zod; reject/flag invalid.
- [ ] Emit a per-provider outcome summary for logging.

**Technical Notes:** `allSettled` gives partial-success semantics. Precedence rules should be config, not hardcoded, so tuning doesn't touch code.

---

## STORY-03.6 — Persistence of scrape results
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-03.5, EPIC-02 (STORY-02.6)

**Acceptance Criteria**
- Validated `ScrapeResult` is persisted via repositories in a single transaction: upsert stock, append price row, upsert financials/ratios/dividends by their unique keys.
- Idempotent — re-running a scrape for the same period does not create duplicates.
- A `SyncLog` row is created at start and completed (status, duration, error) at end.

**Tasks**
- [ ] Implement `persistScrapeResult` using the transactional repository helper.
- [ ] Map DTO → repository upsert calls honoring unique constraints.
- [ ] Write SyncLog lifecycle (start → success/partial/failed).

**Technical Notes:** Depends on EPIC-02 unique constraints for idempotency. Keep persistence out of the scraper classes — orchestrator/service calls repositories.

---

## STORY-03.7 — Scraper resilience & error taxonomy
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-03.2

**Acceptance Criteria**
- Typed error classes distinguish: `SiteUnavailableError`, `NavigationTimeoutError`, `InvalidSymbolError`, `ParseError` (HTML changed), `RateLimitedError`.
- In-scraper retry for transient errors (nav timeout, site unavailable) with capped attempts; non-transient (invalid symbol) fail fast.
- `ParseError` carries which selector failed to aid maintenance.
- Errors surface structured context to logging (EPIC-08) and the job layer (EPIC-05) for backoff decisions.

**Tasks**
- [ ] Define the scraper error hierarchy in `types/errors`.
- [ ] Classify failures at extraction/navigation points.
- [ ] Add transient-vs-permanent retry policy inside the scraper (separate from BullMQ retries).
- [ ] Ensure errors serialize cleanly to logs.

**Technical Notes:** Two retry layers exist — fast in-scraper retry for flaky nav, and BullMQ job-level retry (EPIC-05). Keep them from compounding into excessive attempts.

---

## STORY-03.8 — Configurable concurrency & polite scraping
**Points:** 3 · **Priority:** P1 · **Depends on:** STORY-03.2

**Acceptance Criteria**
- Max concurrent pages and inter-request delay are configurable via env.
- A shared rate limiter prevents hammering a single host.
- User-agent and viewport are set to reasonable values.

**Tasks**
- [ ] Add concurrency + delay config and a semaphore/limiter around page acquisition.
- [ ] Set UA/viewport/headers.
- [ ] Document tuning guidance.

**Technical Notes:** Reduces anti-bot/rate-limit risk. Align limits with worker concurrency (EPIC-05) so total load is bounded.

---

## Epic-level risks & open questions
- **Risk (High):** Source HTML drift breaks selectors. Mitigated by centralized selector config, Zod validation, `ParseError` with selector context, and parse-failure alerting (EPIC-08).
- **Risk (High):** Anti-bot measures. Mitigated by concurrency limits, delays, resource blocking, and backoff.
- **Open question:** Field precedence between PSX and Sarmaaya when both provide a value — needs a domain decision; default assumption documented in STORY-03.5.
- **Open question:** Are financials/dividends historical (multi-row) on both sources, or latest-only? Affects fixture design and upsert keys.
