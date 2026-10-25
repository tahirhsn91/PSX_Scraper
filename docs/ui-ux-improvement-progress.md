1|# UI/UX improvement programme — progress
2|
3|Branch `feat/ui-ux-improvement`, cut from `develop` at `02ce4a2`. Source of findings:
4|`docs/ux-audit.md` (phase 1, merged in #265). Design system reference: `docs/design-system.md`.
5|
6|**Resume here:** check the table, then `git status` and `git diff develop --stat`. Phases marked
7|Completed are done and verified; do not redo them.
8|
9|## Status
10|
11|| Phase | Name | Status | Gate |
12||---|---|---|---|
13|| 1 | UX audit & user research | Completed (PR #265) | — |
14|| 2 | UI/UX design improvements | Completed | tsc, build, browser |
15|| 3 | Design system & components | Completed | tokens test, doc |
16|| 4 | Responsive design | Completed | 40-combination sweep |
17|| 5 | Dashboard & data visualisation | Completed | visual + a11y pass |
18|| 6 | Interaction design & feedback | Completed | e2e alerts journey |
19|| 7 | Accessibility | Completed | axe (8 routes × 2 widths) |
20|| 8 | Frontend performance | Completed | build + API timing |
21|| 9 | Usability testing | In progress | Playwright journeys |
22|| 10 | Final QA | Not started | full gates |
23|
24|## Corrections to the phase-1 audit
25|
26|Four findings did not survive contact with the code and were **not** "fixed":
27|
28|- **UX-04 (sync telemetry first)** — the three queue tiles were already `isDev`-only; production
29|  shows only "Tracked stocks". The real problem was narrower: dev-only metrics were styled as
30|  product KPIs. Covered by the status line in phase 2.
31|- **UX-10 (no in-page nav on the stock page)** — `QuickJumpNav` already exists and is mounted at
32|  `StockDetails.tsx:614`; the audit's anchor scan could not see it because it renders buttons.
33|- **UX-03 attribution** — the seven `h1`s came from `StatTile`'s `centered` variant (value rendered
34|  as `h1`), not from the dashboard's own KPI row.
35|- **UX-12 (dead "Sync latest data" in prod)** — the button is `isDev`-only, so production never
36|  shows it.
37|
38|## Phase 2 — UI/UX design improvements
39|
40|| File | Change |
41||---|---|
42|| `components/ui/StatTile.tsx` | KPI value is a `<p>`; `h1` size kept, heading semantics dropped (dashboard now has exactly one `h1`) |
43|| `components/shell/AppHeader.tsx` | Five primary pills + a "More" menu below `xl` (Announcements, Alerts, Watchlist, Compare, dev-only Sync Logs). The menu takes the active page's name and `aria-current`, so the bar never hides where you are. Pills 34 → 40px |
44|| `pages/Announcements.tsx` | Uses `PageHeader` (breadcrumb + real `h1`) |
45|| `pages/StockDetails.tsx` | Error state separates 404 ("no tracked record") from network/5xx ("could not reach the data service") and offers Retry |
46|| `pages/Dashboard.tsx` | Redundant "Tracked stocks" KPI card removed (the subtitle already states it); queue depth is one caption line (dev only) linking to `/logs` |
47|| `components/IndicesPanel.tsx` | Breadth strip labelled "Indices" with counts in its `aria-label` |
48|| `pages/Alerts.tsx` | Scope caveats moved below the create form |
49|
50|## Phase 3 — Design system & components
51|
52|The app already had `theme/tokens.ts` (contrast-annotated, light + dark), `theme/components.ts`
53|(component defaults) and a `components/ui/` primitive set. Phase 3 consolidated rather than replaced:
54|
55|- `docs/design-system.md` — token tables, component inventory, control-state matrix, rules.
56|- `src/theme/tokens.test.ts` — 31 assertions: 27 contrast pairs in both modes (text 4.5:1, controls
57|  3:1) plus type-scale/radius/layout checks. Runs in `npm test`, so a colour edit that breaks AA
58|  fails CI.
59|- `Chip size="small"` 22 → 26px: it was under the 24px WCAG 2.2 target minimum (2.5.8), and the
60|  filter chips on Announcements / Dividends / Screener are buttons.
61|- Selected `ToggleButton` text now uses a darker green in light mode: `primary` on its own 8% wash
62|  measured 4.3:1 (axe).
63|
64|## Phase 4 — Responsive design
65|
66|Measured 8 routes × 5 widths (320 / 375 / 768 / 1024 / 1440), then fixed what failed:
67|
68|- **320px overflowed by 6px on every route** — the header carried a redundant search icon that the
69|  bottom bar already provides below `md`. Hidden below `sm`; all 40 combinations now report
70|  `scrollWidth === innerWidth`.
71|- Header nav no longer clips at 1440 (phase 2), so the only remaining nav is the bottom bar (56px
72|  targets) below `md`.
73|- Tables keep their container-scroll behaviour; dialogs already had their own small-screen margins.
74|
75|Result: **0 overflow, 0 clipped nav** across 40 route/width combinations.
76|
77|## Phase 5 — Dashboard & data visualisation
78|
79|- One `h1` on the dashboard; KPI values no longer enter the heading outline.
80|- The indices breadth strip says what it counts, so it can no longer be read as the stock breadth
81|  card below it.
82|- KPI row removed where it duplicated the page subtitle, so the board starts with the market.
83|- Compare: each series now has its own dash pattern (and the legend swatch matches) — the lines no
84|  longer rely on colour alone. The performance chart's index line is dashed for the same reason.
85|- Charts already carried `role="img"` with a textual summary (candle chart, sparklines, breadth
86|  bar), so no new summaries were needed.
87|
88|## Phase 6 — Interaction design & feedback
89|
90|- **Deleting an alert** was a one-tap irreversible action; it now opens `ConfirmDialog` naming the
91|  symbol and the condition, with the delete shown as `tone="error"`.
92|- Alert create / pause / resume / delete now raise a toast; a failed delete reports an error.
93|- Existing good behaviour kept: create is disabled until valid, the mutation disables itself while
94|  pending, the search dialog traps focus and restores it.
95|
96|## Phase 7 — Accessibility
97|
98|Automated: axe-core 4.10 (WCAG 2.0/2.1/2.2 A + AA) over 8 routes × 2 widths, plus the search
99|dialog and the header menu.
100|
101|| Finding | Fix |
102||---|---|
103|| `aria-dialog-name` (critical): the search dialog's label sat on the Modal root, not the `role="dialog"` paper | `aria-labelledby` + sr-only title |
104|| `scrollable-region-focusable` (serious): the results listbox could not be scrolled from the keyboard | `tabIndex={0}` on the listbox |
105|| `color-contrast` (serious): selected toggle text 4.3:1 | darker green in light mode |
106|| `color-contrast` (serious): filled warning chip rendered white-on-page (1.12:1) when the queue had failures | replaced with plain text in `warning.main` |
107|| `color-contrast` (serious): decliner count in `error.main` on the page = 4.3:1 | `down.onSoft`, and a token test now guards it |
108|
109|After the fixes the sweep reports **0 violations** on the 16 page/width combinations, the search
110|dialog and the More menu. (`region` on a portalled MUI menu/dialog is a known axe false positive and
111|is not counted.)
112|
113|Not performed: real screen-reader testing (NVDA/VoiceOver), colour-blind simulation, zoom to 400%.
114|These are listed as limitations.
115|
116|## Phase 8 — Frontend performance
117|
118|Baseline (already in place before this phase): route-level `React.lazy`, self-hosted variable font
119|with `preload`, gtag deferred to `load`, icon PNG sized 32px, charts drawn on canvas.
120|
121|Changes:
122|
123|- **Index summary endpoint: 7.7s → 0.06–0.34s.** `derivedVolumes()` computed the constituent-volume
124|  derivation for all 18 indices on a *single* index page; it now takes an optional index id.
125|  Measured with `curl` (5 samples before, 3 after). This is what made `/indices/KSE100` spend 25–45s
126|  behind a skeleton.
127|- **Vendor chunk split** (`vite.config.ts` `manualChunks`): entry was 536 KB and changed whenever a
128|  page changed. Now `react`, `mui`, `data` and `vendor` are separate, long-lived chunks.
129|
130|Production build after the split (gzip not included; sizes are the emitted files):

| Chunk | Before | After |
|---|---|---|
| entry (`index-*.js`) | 536 KB | **53 KB** |
| `vendor-*.js` | — | 922 KB |

The entry now contains only the shell; the vendor chunk changes on a dependency bump, not on a page
edit. First attempt split react/mui/data into three groups and produced `Cannot access 'te' before
initialization` at runtime — the build succeeded and the page was blank, which is why the built
`dist` is now loaded in a browser before anything is called verified. One vendor group fixes it.
131|
132|Known remaining cost: `/indices?limit=50` still takes ~3.3s under an active sync; the dev Postgres
133|is capped at 512 MB with `shared_buffers=128MB` against a 1.1 GB database, so most reads miss cache.
134|That is an environment limit, not a query plan (the scopes query itself runs in 8 ms).
135|
136|## Phase 9 — Usability testing
137|
138|`frontend/e2e/journeys.spec.ts` — ten journeys: dashboard → index detail, keyboard search (focus,
139|results, Escape, focus return), no-results copy, screener filter in the URL + reload, clearing
140|filters, quick-jump scroll, unreachable-API error + Retry, alert delete confirmation (cancel keeps
141|the row), mobile bottom bar, and 320px overflow.
142|
143|`frontend/playwright.config.ts` raised to 90s/20s with one worker: the stack syncs 500 symbols while
144|the tests run, and 45s/10s produced failures that passed when re-run alone.
145|
146|Results against the production build (`vite build`, served statically, API on :4001):

- **14/14 passed in 2.1 minutes** (10 journeys + 4 smoke), after fixing the two real defects below.
- Defects found and fixed:
  - **Alerts API returned 500 on every call** (`prisma.alert` undefined at runtime). Cause: the dev
    backend's Prisma client was generated on 14 October, before migration `0028_alerts`; the fresh
    client landed in `/app/node_modules/.prisma` while Node resolves `/app/backend/node_modules/.prisma`.
    Copied the client, restarted, `GET /alerts` → 200. Production was checked read-only and answered
    200, so this was a dev-container defect, not a release blocker.
  - **`smoke.spec.ts` still looked for an inline search combobox** that the dialog replaced; it had
    never run in CI. Rewritten to open the dialog and assert focus.
- One test-only fix: `playwright.config.ts` budgets raised to 90s/20s and one worker; 45s/10s failed
  under an active sync and passed when re-run alone.
- Journey results: index card → detail 26s (first paint of the board is the slow part, see phase 8),
  keyboard search 10s, no-results copy 7s, filter+reload 9s, clear filters 6s, quick-jump 11s,
  error+retry 4s, alert confirm 14s, mobile 3–4s.
147|
148|## Phase 10 — Final QA
149|
150|Not started.