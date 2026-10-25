# UX audit — phase 1: inventory, issues, priorities

**Date:** 2026-10-25
**Scope:** every route in `frontend/src/App.tsx` (15, including the 404), at 1440 / 1024 / 390 px.
**Environment:** dev stack (`169.58.108.61:5200`, API `:4001`).
**Method:** code reading plus a scripted Playwright sweep of every route at three widths, then targeted
re-checks of anything the sweep flagged. Measurements are in the appendix; screenshots and the raw
JSON live in the session scratch (`ux/`, `ux/audit.json`).

No application code was changed in this phase — this document is the deliverable.

## Executive summary

The product is in better shape than a 15-page audit usually finds: **no page overflows horizontally
at any width**, **zero console errors** on every route, every empty state explains itself, and the
"no data is not zero" rule (`—`) holds throughout. The problems are concentrated in three places:
the **header** (a nav item is clipped at 1440), the **dashboard's information hierarchy** (internal
sync telemetry occupies the first screen), and **error/loading states that lie or never end**
(a network failure reported as "symbol may not exist"; a ticker stuck on "Loading…").

Two of the six high findings are one-line fixes; two are component-level; two need a decision about
what the dashboard is *for*.

| Severity | Count | Theme |
|---|---|---|
| High | 6 | header clipping, misleading error state, heading semantics, dashboard hierarchy, index-page latency, stuck ticker |
| Medium | 6 | missing h1, ambiguous breadth label, alert-page copy, long stock page, mobile nav, dead sync CTA |
| Low | 3 | theme menu, no search shortcut, name suffix noise |

## High

### UX-01 — The header nav is clipped at 1440 px

**Evidence.** `nav` box: `clientWidth 832`, `scrollWidth 853`, `overflow-x: auto`. The last item
(`Sync Logs`) ends at x=1055 while the nav ends at 1034; the search button begins at 1046. The item
is half-hidden under the search control and the nav scrolls horizontally with no affordance.
A screenshot at 1440 shows "Sync Log" with its final letter cut.

**Why it matters.** The ninth destination is undiscoverable at a common desktop width, and a
horizontally scrollable nav bar is invisible to anyone without a trackpad gesture.

**Recommendation.** Let the nav shrink or move overflow into a "More" menu below ~1500 px; do not
rely on the scroll container. Acceptance: `nav.scrollWidth <= nav.clientWidth` at 1280/1440, and
every nav label fully visible.

**Effort:** S (1 file, `AppHeader.tsx`).

### UX-02 — A network failure is reported as "this symbol may not exist", with no retry

**Evidence.** With every `/api/v1/**` request aborted, `/stocks/OGDC` renders an alert:
"Could not load OGDC — It may not be tracked yet, or the symbol is not on the exchange." and offers
one action, "Back to the market board". There is no Retry control.

**Why it matters.** The message blames the data for a connectivity problem, and the only escape is
backwards. This is the single most misleading string found in the audit.

**Recommendation.** Distinguish "not found" (404) from "could not reach the server" (network/5xx),
and offer `Retry` for the latter. Acceptance: aborting API calls shows "Could not reach the server"
plus a working Retry.

**Effort:** S–M (`StockDetails.tsx` error branch, one shared error classifier).

### UX-03 — The dashboard has seven `<h1>` elements

**Evidence.** `h1` text list: `["Market board", "83", "233", "57", "501M", "3", "1"]` — the page
title plus every KPI value, because KPI values use `Typography variant="h1"`.

**Why it matters.** A screen-reader user navigating by heading hears "heading level 1: 83", then
"heading level 1: 233". The document outline carries no meaning.

**Recommendation.** One `h1` per page; KPI values become `Typography variant="h5"` inside a
labelled card (the existing house KPI pattern already does this).

**Effort:** S (`Dashboard.tsx`, `StatCard`/KPI component).

### UX-04 — The first screen is internal sync telemetry, not market information

**Evidence.** The KPI row reads: `TRACKED STOCKS 511 · ACTIVE SYNCS 2 · WAITING 498 · FAILED 201`.
On a 390 px phone this row fills the entire first screen, together with a "Syncing… 2 active, 498
waiting" bar. The word "FAILED" is the largest coloured value on the page. These are BullMQ queue
counts (`/sync/status`), a developer metric.

**Why it matters.** A visitor — or Tahir demoing the product — meets "FAILED 201" before any market
figure. It reads as a broken product rather than a busy pipeline, and it is meaningless to anyone
who is not operating the scraper.

**Recommendation.** Decide who the dashboard is for. For a market-intelligence product, lead with
breadth / index / movers and move queue health behind the dev-only `/logs` page (where the sync
tables already live). If operators need it, show "2 syncing" as a quiet status line, not a KPI tile.

**Effort:** M (layout change + a product decision).

### UX-05 — An index page took 25–45 s to show anything

**Evidence.** `/indices/KSE100` rendered a full-page skeleton at 10 s, 25 s and 35 s, and only
produced content (h1 "KSE100") by 45 s. While it waited, three API calls were still open after 20 s:
`/indices/KSE100` (18.0 s), `/indices?limit=50` (19.4 s) and `/market/overview` (19.4 s). Direct
measurement of the same endpoints: `/indices?limit=50` 5.9 / 7.2 / 9.6 / 10.2 s and
`/indices/KSE100` 3.6–8.3 s. In comparison `/stocks/OGDC` is 0.18 s, `/stocks` 0.42 s and
`/market/status` 0.02 s.

**Caveat.** Every measurement was taken while the stack was syncing (486–504 jobs queued, 2 active),
so this is an under-load figure; steady state is unmeasured. It is still what a user sees during a
sync — and there is no progress, no timeout and no partial render to soften it.

**Recommendation.** Measure again while idle; if it stays above ~1 s, the query is the problem (the
indices list also powers the ticker, so it is on every page). Regardless, the page should show the
index header from a cheap call and load the chart after, rather than blanking everything.

**Effort:** M (query/index work in `market.repository`; check `index_values` indexes).

### UX-06 — The mobile ticker can stay on "Loading today's movers…" indefinitely

**Evidence.** On `/stocks/OGDC` at 390 px, the strip under the header still read "Loading today's
movers…" at 3 s, 6 s and 10 s, while the same strip on `/` showed live quotes within 2 s. The
component shows that text while `moversLoading` is true and `entries` is empty; there is no
timeout, error state, or reflow when the query never settles.

**Recommendation.** Give the strip a failure state (render nothing, per the house rule "nothing to
say → return null") once the query has been pending past a threshold, and cap it at one retry.

**Effort:** S (`MarketTicker.tsx`).

## Medium

### UX-07 — `Announcements` has no `h1`
Only `h2 "Latest notices"` exists; the page title is a `PageHeader` without an `h1`. Same for the
index page in one measurement pass (it renders `h1` only when data arrives — see UX-05).
**Fix:** promote the page title to `h1`. **Effort:** S.

### UX-08 — Two different "advancers/decliners" on one screen, only one is labelled
The indices strip reads `▲ advancers 1 ▼ decliners 17 · unchanged 0` (of 18 indices) directly above
the Market breadth panel showing `83 / 233 / 57` (of 511 stocks). Nothing in the strip says it is
counting indices; the only hint is "PSX Indices (18)" on the line above.
**Fix:** "1 of 18 indices up" or move the strip into the indices panel header. **Effort:** S.

### UX-09 — The Alerts page front-loads three paragraphs of caveats
Before any control: what alerts are, that checks only run while the page is open, that nothing is
emailed, that clearing site data removes them, and the one-hour cooldown. Honest, but the primary
action is pushed down and the page reads as legal copy.
**Fix:** keep the caveats, move them under the form or into an expandable "How this works".
**Effort:** S.

### UX-10 — The stock page is 13 sections with no in-page navigation
`h2`s: Price history, Performance, Technical, Dividend history, Announcements, Company Description,
plus fundamentals sub-sections. The only page-level anchor is the skip link, so reaching the last
section is a long scroll on a phone.
**Fix:** a sticky section chip row (the quick-jump idea already exists in the codebase for the
technical block). **Effort:** M.

### UX-11 — Mobile navigation: 32–34 px targets and a dev-only destination
Header and bottom-nav items measure 34 px high (Alerts 64×34, Watchlist 78×34, Compare 80×34,
Sync Logs 84×34) and the screener's filter chips 32 px (Gainers 76×32, Losers 68×32, "Most active"
98×32) against the 44 px recommendation. The bottom bar also includes "Sync logs", a route that
only exists in dev — correct in production, confusing while demoing.
**Fix:** 44 px minimum on touch; hide dev-only destinations from the mobile bar. **Effort:** S.

### UX-12 — "Sync latest data" is a primary CTA that now fails in production
Since the admin-token change (#215), every mutating endpoint returns 503 when `ADMIN_TOKEN` is
unset — and it is unset in production. A stock page's most prominent button is therefore a dead
end there. Not a UX defect in dev, but a user-visible one in prod.
**Fix:** configure the token, or hide/disable the button when the API reports `ADMIN_DISABLED`.
**Effort:** S.

## Low

- **UX-13** — Theme is a three-item menu (Light / Dark / Match system) behind one icon; a single
  toggle would be fewer clicks, and the icon sits beside the portfolio icon, which reads as two
  similar controls on mobile.
- **UX-14** — No keyboard shortcut for search (`/` or `⌘K`); the dialog itself is well built
  (focus moved to the field, Escape closes, MUI focus trap).
- **UX-15** — Company names carry provider artifacts: "Oil & Gas Development Company Limited**XD**",
  sector in full caps.

## What is already good — do not regress in phase 2

- **Skip link** is the first tab stop ("Skip to content" → `#main`).
- **Empty states explain the next action** on all four checked (watchlist, alerts, search,
  screener). The screener's is exemplary: "Loosen the criteria — the current filters match no
  tracked stock", with Clear.
- **Errors are announced**: `role="alert"` on the stock error, `aria-busy` on loading regions.
- **Skeletons instead of spinners** on dashboard, screener, stock and index pages.
- **Zero horizontal overflow** at 390 / 1024 / 1440 on all 15 routes, and no clipped figures on the
  pages checked — the table-column work of earlier phases holds.
- **Dark mode** is real: selecting Dark sets `data-theme="dark"`, `--bg rgb(22,24,23)`, and persists
  in `localStorage['color-mode']`; Light/Dark/Match system are all present.
- **The screen is the URL** on the screener, and breadcrumbs are on every detail page.
- **Provenance is visible**: source captions on fundamentals, "last sync success", freshness line
  ("End of day · as of 21:04 today"), Shariah membership with its index and read date.

## Priority order for the next phase

1. **UX-02** and **UX-06** — states that mislead or never end (small, high trust impact).
2. **UX-01** — header clipping (small, always visible).
3. **UX-03**, **UX-07** — heading semantics (small, accessibility).
4. **UX-04** — dashboard hierarchy (needs your call on audience: investor vs operator).
5. **UX-05** — index latency (measure idle first; likely a query/index fix).
6. **UX-08 … UX-12** — labelling, copy, mobile targets, section nav.

Suggested acceptance for the phase: every fix verified at 390/1024/1440, `tsc` and `build` clean,
the frontend test suite green, and no new console errors on any route.

## Appendix — measurements

**Route sweep (desktop 1440 / tablet 1024 / mobile 390)**

- Page-level horizontal overflow: **none** on any route at any width.
- Console errors: **0** on every route.
- `h1` count: dashboard **7**; screener, stock, compare, movers, sectors, dividends, search,
  watchlist, alerts, logs **1**; announcements **0** (only `h2 "Latest notices"`). The index page
  has **0** while its skeleton is up and **1** ("KSE100") once it finally loads — see UX-05.
- Unnamed controls: **0** once `<label for>` is counted (inputs in Dividends/Alerts/Compare are
  labelled by their MUI labels).
- Touch targets under 44 px on mobile: the navigation row is 34 px high and the screener's filter
  chips are 32 px; both are below the 44 px recommendation. Whole-page counts vary with how much
  content has rendered, so the measured element sizes above are the evidence, not a per-page total.

**API latency (dev, during an active sync; `curl`, 1 call each unless noted)**

| Endpoint | Time |
|---|---|
| `/market/status` | 0.02 s |
| `/alerts` | 0.01 s |
| `/stocks/OGDC` | 0.18 s |
| `/stocks?page=1&limit=50` | 0.42 s |
| `/market/overview` | 2.26 s |
| `/indices/KSE100` | 3.6 / 6.0 / 6.3 / 6.3 / 7.7 / 8.3 s (6 calls) |
| `/indices?limit=50` | 5.9 / 7.2 / 9.6 / 10.2 s (4 calls) |

**Header geometry (1440 px)**

```
nav           left 202   right 1034   clientWidth 832   scrollWidth 853   overflow-x auto
Sync Logs     left 971   right 1055   (21 px past the nav's right edge)
Search button left 1046  right 1134   (overlaps the nav's last item by 9 px)
```

**Error-state probe** (all `/api/v1/**` aborted): `role="alert"` present, text "Could not load
OGDC — It may not be tracked yet, or the symbol is not on the exchange.", retry buttons: `0`.
