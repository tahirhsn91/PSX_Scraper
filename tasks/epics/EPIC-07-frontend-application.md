# EPIC-07 — Frontend Application

**Priority:** P1 · **Total points:** 55 · **Depends on:** EPIC-04, EPIC-06

## Goal
Build the React + Vite + TypeScript SPA with four pages (Dashboard, Search Results, Stock Details, Sync Logs) using Material UI, React Query for server state, React Router for navigation, Axios for transport, and Context API for app-wide concerns (theme). Responsive with dark mode.

---

## STORY-07.1 — Frontend architecture & app shell
**Points:** 8 · **Priority:** P1 · **Depends on:** EPIC-01

**Acceptance Criteria**
- Vite + TS app with a maintainable structure (`pages/`, `components/`, `features/`, `api/`, `hooks/`, `providers/`, `theme/`, `types/`).
- React Router routes for the four pages + not-found; layout shell with responsive AppBar/nav.
- MUI theme provider wired; Axios instance configured with `VITE_API_URL`, interceptors for errors, and a request-id header.
- React Query `QueryClient` provider with sensible defaults (retry, stale time).

**Tasks**
- [ ] Scaffold folder structure and routing.
- [ ] Build responsive layout shell (AppBar, nav, content area).
- [ ] Configure Axios instance + interceptors + typed API client.
- [ ] Set up QueryClient provider and MUI ThemeProvider.

**Technical Notes:** Centralize the Axios client and generate/maintain typed API bindings from the OpenAPI spec (EPIC-04 STORY-04.8) to avoid drift.

---

## STORY-07.2 — Theme & dark mode (Context API)
**Points:** 5 · **Priority:** P1 · **Depends on:** STORY-07.1

**Acceptance Criteria**
- A theme Context toggles light/dark; MUI palette responds; preference persists across reloads (respecting the "no localStorage in sandboxed artifacts" caveat — this is a real app, so persistence via localStorage/OS preference is fine here).
- System preference (`prefers-color-scheme`) is the initial default.
- All pages/components are theme-aware (no hardcoded colors).

**Tasks**
- [ ] Implement `ColorModeContext` + provider and toggle control.
- [ ] Define light/dark MUI palettes.
- [ ] Persist + hydrate preference; honor system default.

**Technical Notes:** Context API is explicitly requested for app-wide state; theme mode is the canonical use.

---

## STORY-07.3 — Data layer: React Query hooks
**Points:** 8 · **Priority:** P1 · **Depends on:** STORY-07.1, EPIC-04

**Acceptance Criteria**
- Typed query/mutation hooks for: list stocks, get stock detail, search, add stock, delete stock, trigger sync, get sync status, get sync logs, get history.
- Mutations invalidate the right queries on success (e.g. add/sync → invalidate detail + list + logs).
- Loading/error/empty states are first-class; polling used for in-progress sync status.

**Tasks**
- [ ] Define query keys and typed hooks per endpoint.
- [ ] Implement mutation hooks with cache invalidation.
- [ ] Add polling (refetchInterval) for active sync status.
- [ ] Centralize error normalization from the API envelope.

**Technical Notes:** React Query owns server state; avoid duplicating it in Context. Poll sync status only while a job is active, then stop.

---

## STORY-07.4 — Dashboard page
**Points:** 5 · **Priority:** P1 · **Depends on:** STORY-07.3

**Acceptance Criteria**
- Landing page lists tracked stocks (symbol, company, current price, change %, last synced) in a responsive MUI table/cards.
- Prominent search entry and an "Add Stock" action.
- Shows global sync status summary (from `/sync/status`).
- Loading skeletons and empty state ("no stocks yet — add one").

**Tasks**
- [ ] Build dashboard layout + stock list (table on desktop, cards on mobile).
- [ ] Add search box + Add Stock dialog (calls add mutation).
- [ ] Surface sync status summary widget.
- [ ] Skeletons + empty/error states.

**Technical Notes:** Add Stock dialog validates symbol client-side before submit; shows enqueue confirmation + progress reference.

---

## STORY-07.5 — Search Results page
**Points:** 5 · **Priority:** P1 · **Depends on:** STORY-07.3, EPIC-06

**Acceptance Criteria**
- Reflects `GET /search?q=` with debounced input; shows symbol, company, current price, latest synced date, last trade date.
- Each result is clickable → navigates to Stock Details.
- Handles no-results, short-query, and loading states; result count shown.

**Tasks**
- [ ] Build search page with debounced query + URL-synced `q` param.
- [ ] Result list with navigation to details.
- [ ] Empty/short-query/loading handling.

**Technical Notes:** Debounce (~300ms) and sync `q` to the URL for shareable searches. Backed by cached search (EPIC-06 STORY-06.2).

---

## STORY-07.6 — Stock Details page
**Points:** 13 · **Priority:** P1 · **Depends on:** STORY-07.3, EPIC-04 (STORY-04.3, 04.5, 04.6)

**Acceptance Criteria**
- Displays company info, current price/OHLC, historical data, financials, ratios, dividend history, and last sync status — organized into tabs/sections.
- "Sync Latest Data" button triggers on-demand sync, shows a progress indicator while running, and refreshes the view on completion.
- Historical price data rendered as a chart (with range selection) backed by the history endpoint.
- Graceful handling of partially-synced/missing data (e.g. "no dividends recorded").

**Tasks**
- [ ] Build details layout with sections/tabs (Overview, Financials, Ratios, Dividends, History).
- [ ] Wire "Sync Latest Data" mutation + progress indicator + auto-refresh on complete.
- [ ] Add price history chart (MUI X Charts / Recharts) with range selector.
- [ ] Handle missing/partial data states and last-sync badge.

**Technical Notes:** Largest story — consider splitting per section if it exceeds a sprint. Progress indicator polls sync status (STORY-07.3) until the job completes, then invalidates the detail query.

---

## STORY-07.7 — Sync Logs page
**Points:** 5 · **Priority:** P2 · **Depends on:** STORY-07.3, EPIC-04 (STORY-04.7)

**Acceptance Criteria**
- Paginated, filterable table of sync logs (status, symbol, date range) from `/sync/logs`.
- Shows status, started/completed, duration, and error message on failure.
- A control to trigger `POST /sync/all` with confirmation.

**Tasks**
- [ ] Build logs table with server-side pagination + filters.
- [ ] Status chips + expandable error detail.
- [ ] "Sync All" action with confirmation dialog.

**Technical Notes:** Status color-coded chips (SUCCESS/PARTIAL/FAILED). Sync-All is a heavy action — confirm before firing.

---

## STORY-07.8 — Responsive design & accessibility polish
**Points:** 3 · **Priority:** P2 · **Depends on:** STORY-07.4–07.7

**Acceptance Criteria**
- All four pages usable from mobile to desktop breakpoints (MUI Grid/responsive).
- Keyboard navigation and basic a11y (labels, focus, contrast in both themes) verified.
- No layout breakage in dark mode.

**Tasks**
- [ ] Responsive audit across breakpoints; fix overflow/stacking.
- [ ] a11y pass (labels, roles, focus order, contrast).

**Technical Notes:** Lean on MUI's responsive primitives; verify dark-mode contrast meets WCAG AA on key text.

---

## STORY-07.9 — Global error & loading UX
**Points:** 3 · **Priority:** P2 · **Depends on:** STORY-07.3

**Acceptance Criteria**
- App-wide error boundary + toast/snackbar for mutation errors using the API error envelope.
- Consistent loading skeletons and retry affordances.
- Network/offline handling surfaced to the user.

**Tasks**
- [ ] Add React error boundary + MUI Snackbar provider.
- [ ] Standardize skeletons + retry buttons.

**Technical Notes:** Normalize the API error envelope (EPIC-08) into user-friendly messages centrally.

---

## Epic-level risks & open questions
- **Risk:** Details page scope (STORY-07.6, 13 pts) is large — split by section if needed.
- **Open question:** Charting library preference (MUI X Charts vs Recharts) — pick one for consistency.
- **Dependency:** Typed API client benefits from the OpenAPI spec (EPIC-04 STORY-04.8); if unavailable, hand-maintain types.
