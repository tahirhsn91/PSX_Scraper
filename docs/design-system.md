# Design system

The app has one visual language, defined in `frontend/src/theme/` and enforced by component
defaults. This document is the inventory and the rules; the source of truth stays the code.

```
theme/
  tokens.ts      colour, type, radius, motion, layout, shadows — with the measured contrast ratio
  components.ts  MUI defaults: every control's hover / focus / active / disabled state
  index.ts       builds the MUI theme and widens the palette with the app's own slots
```

`tokens.test.ts` re-measures thirteen contrast pairs in both modes on every test run, so a colour
edit that breaks AA fails CI rather than shipping.

## Colour

Colours are semantic roles, never literals in pages. Pages read `theme.palette.*`; charts read
`theme.palette.chart`, trend text reads `palette.up` / `palette.down`.

| Role | Light | Dark | Used for |
|---|---|---|---|
| `background.default` | `#F1F1F1` | `#161817` | page |
| `background.paper` | `#FFFFFF` | `#222524` | cards, inputs, menus |
| `surfaceElevated` | `#FFFFFF` | `#2B2F2D` | popovers over cards |
| `sunken` | `#F8F8F8` | `#0F1110` | inset wells, disabled fills |
| `divider` | `#D8D8D8` | `#3A3F3D` | hairlines (decorative) |
| `borderStrong` | `#757575` | `#8A908D` | control outlines (≥3:1, WCAG 1.4.11) |
| `text.primary` | `#333333` | `#F1F1F1` | body |
| `text.secondary` | `#666666` | `#C9CCCB` | supporting copy |
| `text.disabled` | `#6B6B6B` | `#A8ADAB` | placeholder, muted labels |
| `primary` | `#007A42` | `#32CE8A` | primary action, focus ring |
| `up` / `down` | green / red pairs with `soft` + `onSoft` | — | direction: **always with an arrow or sign**, never colour alone |
| `accent` | `#D6A333` | `#E0B95C` | reference series, "not comparable" marks |
| `nav.*` | dark bar in both modes | — | the app bar is its own surface, not a card |

Rules:
- Never write a hex value in a page or component. If a role is missing, add it to `ModeTokens` and
  both modes, then run `tokens.test.ts`.
- Direction colour always travels with `ChangePill`'s arrow and sign (Phase 7 lists the exceptions).
- Charts answer to the 3:1 non-text threshold; text answers to 4.5:1. That is why `chart.up` and
  `up.main` are different greens.

## Typography

One family (`Plus Jakarta Sans`, system fallback), one scale, mapped onto MUI variants:

| Variant | Size / line | Use |
|---|---|---|
| `h4` (`PageHeader`) | 24 / 1.33 | the single `h1` on a page |
| `h5` | 20 / 1.4 | KPI value (rendered as `<p>`, never a heading) |
| `h6` (`SectionCard`) | 17 / 1.41 | section `h2` |
| `body1` | 15 / 1.48 | body |
| `body2` | 13 / 1.4 | supporting text |
| `caption` | 12 / 1.35 | metadata, hints |
| `overline` | 11 / 1.45, uppercase | KPI labels, table heads |

All numerals use `font-variant-numeric: tabular-nums` (set on `MuiTableCell`, inputs and every
figure that sits in a column).

## Space, shape, motion

- Spacing: MUI's 8px scale. Cards pad 16px (`SectionCard`), page gutters 16/24px
  (`layout.gutterMobile` / `gutterDesktop`), section gap 20–24px.
- Radii: controls 10px, cards 14px, pills 999px (`radius`).
- Elevation: light mode uses the two shallow shadows in `shadowsFor(light)`; dark mode is flat and
  separates with surface steps and hairlines.
- Motion: 140 / 200 / 320 ms, `cubic-bezier(0.2, 0, 0, 1)`. Only colour, opacity and transform.
  `prefers-reduced-motion` collapses everything to 0.01 ms in `MuiCssBaseline`.

## Components

| Component | Responsibility | Rules |
|---|---|---|
| `PageHeader` | breadcrumb + `h1` + subtitle + actions | every route uses it; one `h1` per page |
| `SectionCard` | titled surface | all page sections; `flush` for tables |
| `StatTile` | one KPI | label + value + optional footer; value is never a heading |
| `ChangePill` | signed change | arrow + sign + colour, never colour alone |
| `DataStatus` | freshness / provenance | one line under the thing it describes |
| `DataTable` | sortable, paginated table | server sort when the API sorts; `ariaLabel` required |
| `StatePanel` | loading / empty / error | empty states must say what to do next |
| `StatusPage` | full-page status | used by 404 and fatal states |
| `ConfirmDialog` | destructive confirmation | names the object and the consequence |
| `ToastProvider` | transient success/failure | `useToast()`; never the only feedback for a destructive act |
| `QuickJumpNav` | in-page sections | sticky, scroll-spy, keyboard reachable |
| `ShariahMark` | Shariah membership | glyph + `title`; absence means "not in this index" |
| `LiveNumber` | animated figures | respects reduced motion; formats through `lib/format` |

## Control states

Defined once in `components.ts`, not per page:

- **Hover** — background wash only (`action.hover`), never a size or position change.
- **Focus** — `:focus-visible` 2px ring in `primary`, offset 2px, on every control including links,
  chips, table sort buttons and menu items.
- **Active / selected** — `selectedWash` + `primary` text; navigation also sets `aria-current`.
- **Disabled** — `text.disabled` label on `sunken`; never lower the contrast of adjacent text.
- **Loading** — skeleton with the same box as the loaded content, or a button label in the
  progressive tense plus `disabled` to prevent a duplicate submit.
- **Error** — `role="alert"`, `error.main` icon + text, and an action that can fix it (retry,
  correct, or navigate).

## Numbers and dates

All formatting goes through `frontend/src/lib/format.ts`: `formatCount`, `formatNumber`,
`formatRupees`, `formatMarketCap`, `formatVolume`, `formatSigned`, `DASH` for "not known". A value
that is missing renders `—`, never `0`.

## Adding a component

1. Check the table above and `components/ui/` first.
2. If it is a variant of an existing component, add a prop instead of a copy.
3. Style through the theme; a one-off `sx` is allowed for layout only.
4. Add a test for behaviour that can regress (formatting, labels, keyboard).

## Known gaps (tracked in the progress doc)

- `Chip size="small"` was 22px tall — below the 24px WCAG 2.2 target minimum. Raised to 26px in
  phase 3.
- The mobile bottom bar is 34px tall: above the 24px minimum, below the 44px comfort guideline.
  Reviewed in phase 4.
- No token for chart heights or table row density; both are still per-page numbers.
