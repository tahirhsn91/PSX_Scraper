import type { PaletteMode } from '@mui/material';

/**
 * Design tokens — the single source of truth for the app's visual language.
 *
 * Sourced from the MyPortfolio365 / PSX design system: the PSX Data Portal's visual language
 * (green brand, dark navigation, financial green/red semantics, gold for neutral and historical
 * series, compact financial typography) modernised rather than cloned.
 *
 * Every colour pair here was contrast-checked with WCAG 2.1 relative luminance before being
 * committed (ratios in the comments). Components must read these through the MUI theme
 * (`theme.palette.*`) rather than importing literals, so light and dark stay in step.
 *
 * Four values in the source document could not be used as given, because they fail AA at the size
 * the app renders them. Each keeps the document's intent and moves one step along its own ramp:
 *
 *   #009952 with white text        3.70:1  -> primary is #007A42 (the document's Primary Dark), 5.44:1
 *   #009952 as text on white       3.70:1  -> same substitution, 5.44:1
 *   #888888 muted text             3.54:1  -> #6B6B6B, 5.33:1 on white and 4.72:1 on the page
 *   #D6A333 gold as a chart line   2.30:1  -> #A87C1C for lines, 3.77:1; #D6A333 is kept for fills
 *
 * #009952 is not lost: it is the chart's own up-colour, where the 3:1 non-text threshold applies and
 * it measures 3.70:1 — the document's exact value, in the role it was specified for.
 *
 * Dark mode is derived, not supplied: the document describes a light interface. Two rules keep it in
 * the same family rather than a second palette — it is built from the document's own charcoal, and
 * it preserves the *relationship* the light mode has, not its literal layers. The clearest case is
 * the navigation bar: in light it is the darkest band on a light page, so in dark it is the lightest
 * band on a dark page. A bar merely set to a darker charcoal than the page reads as no bar at all
 * (1.10:1 between them), which is what this replaces.
 */

export interface TrendColors {
  /** Direction colour: up/down value, candle body, delta text. */
  main: string;
  /** Tinted background for soft pills and rows. */
  soft: string;
  /** Text/icon colour that sits on `soft` (verified >= 4.5:1). */
  onSoft: string;
}

export interface SoftColor {
  main: string;
  soft: string;
}

/** The app's own series colours. Separate from `up`/`down` because a chart line answers to the 3:1
 *  non-text threshold, while delta text answers to 4.5:1 — the same brand green can satisfy one and
 *  not the other, so each role carries the value that actually passes in it. */
export interface ChartColors {
  up: string;
  down: string;
  /** Neutral / historical series — the close-only runs, drawn where there are no candles. */
  gold: string;
  /** Area fill under a gold series. */
  goldFill: string;
  grid: string;
  text: string;
  volumeUp: string;
  volumeDown: string;
}

/** The top bar. A dark navigation strip is part of the PSX identity in both colour modes. */
export interface NavColors {
  bg: string;
  hover: string;
  text: string;
  /** Inactive navigation labels, dimmer than the brand but still >= 4.5:1. */
  textMuted: string;
  /** The active item's label. */
  active: string;
  /** The portfolio call-to-action. It sits on the bar, so it has to separate from the bar as well as
   *  carry a readable label — on charcoal a dark green fill does the first job badly (1.89:1). */
  cta: string;
  ctaText: string;
  field: string;
  fieldText: string;
  /**
   * Everything drawn on the field's own fill rather than on the bar: the magnifier icon and the
   * placeholder. The field is its own surface (white in light, a near-black cavity in dark), so
   * these cannot borrow `textMuted` — `#C9CCCB` on the light field measures 1.62:1. The field
   * carries no visible label at all, because an MUI label straddles the fill and the bar behind it,
   * and no single colour passes against both.
   */
  fieldLabel: string;
  fieldBorder: string;
}

export interface ModeTokens {
  bg: string;
  surface: string;
  surfaceElevated: string;
  sunken: string;
  border: string;
  /** Stronger outline for input/control boundaries (>= 3:1, WCAG 1.4.11). */
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryHover: string;
  primaryActive: string;
  onPrimary: string;
  primarySoft: string;
  onPrimarySoft: string;
  up: TrendColors;
  down: TrendColors;
  warning: SoftColor;
  info: SoftColor;
  accent: SoftColor;
  nav: NavColors;
  chart: ChartColors;
  focusRing: string;
  /** Alpha used by dividers/hover washes that must not fight the surface. */
  hoverWash: string;
  selectedWash: string;
}

export const lightTokens: ModeTokens = {
  bg: '#F1F1F1', // the document's page background
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  sunken: '#F8F8F8', // the document's alternative surface
  border: '#D8D8D8', // the document's border; a separator is decorative, not a control outline
  borderStrong: '#757575', // 4.61:1 on white — control outlines answer to 1.4.11
  text: '#333333', // 11.19:1 on the page
  textSecondary: '#666666', // 5.08:1 on the page
  textMuted: '#6B6B6B', // 4.72:1 on the page (document says #888888 = 3.54:1, under AA)
  primary: '#007A42', // the document's Primary Dark: 5.44:1 with white text, 4.81:1 as text on the page
  primaryHover: '#00693A',
  primaryActive: '#005C33',
  onPrimary: '#FFFFFF',
  primarySoft: '#EAF7F0', // the document's Primary Light / Positive Chart Fill
  onPrimarySoft: '#007A42', // 4.93:1 on primarySoft
  up: { main: '#007A42', soft: '#EAF7F0', onSoft: '#007A42' }, // 5.44:1 / 4.93:1
  down: { main: '#D62F35', soft: '#FCEBEC', onSoft: '#A3161B' }, // the document's red: 4.86:1 / 6.78:1
  warning: { main: '#6B4E0A', soft: '#F2E3C1' }, // 6.08:1 on the gold fill
  info: { main: '#666666', soft: '#EFEFEF' }, // 5.08:1 — the document reserves grey for neutral information
  accent: { main: '#D6A333', soft: '#F2E3C1' }, // the document's gold: a fill and a series colour
  nav: {
    bg: '#3F4140', // the document's dark navigation
    hover: '#505250', // the document's navigation hover; a state wash, not a boundary
    text: '#FFFFFF', // 10.29:1 on the navigation
    textMuted: '#C9CCCB', // 6.36:1 — inactive labels
    active: '#6FDCA6', // 6.11:1; the document's #009952 measures 2.78:1 here and is unreadable
    cta: '#FFFFFF', // 10.29:1 against the bar
    ctaText: '#007A42', // 5.44:1 on the button
    field: '#FFFFFF',
    fieldText: '#333333', // 12.63:1 on the field
    fieldLabel: '#6B6B6B', // 5.33:1 on the field — a step below the input text, and still AA
    fieldBorder: 'rgba(255, 255, 255, 0.28)',
  },
  chart: {
    up: '#009952', // the document's exact green: 3.70:1, passes the 3:1 non-text threshold
    down: '#D62F35', // 4.86:1
    gold: '#A87C1C', // 3.77:1 (document says #D6A333 = 2.30:1, under the line threshold)
    goldFill: '#F2E3C1', // the document's gold fill, used as an area under gold series
    grid: '#D8D8D8', // decorative gridline
    text: '#6B6B6B',
    volumeUp: 'rgba(0, 153, 82, 0.45)',
    volumeDown: 'rgba(214, 47, 53, 0.45)',
  },
  focusRing: '#007A42', // 4.81:1 against the page
  hoverWash: 'rgba(51, 51, 51, 0.04)',
  selectedWash: 'rgba(0, 122, 66, 0.08)',
};

/**
 * Dark mode. Built from the document's charcoal, keeping the light mode's relationships: the bar is
 * the most distinct band, cards step clearly off the page, and the brand green stays saturated rather
 * than washed to a pastel mint (a mint reads as a different product next to the light theme).
 */
export const darkTokens: ModeTokens = {
  bg: '#161817',
  surface: '#222524', // a clear step off the page, not a shade of it
  surfaceElevated: '#2B2F2D',
  sunken: '#0F1110',
  border: '#3A3F3D', // hairline separator: in dark mode depth comes from hairlines, not shadows
  borderStrong: '#8A908D',
  text: '#F1F1F1', // 12.45:1 on the page
  textSecondary: '#C9CCCB', // 8.69:1 on the page
  textMuted: '#A8ADAB', // 5.20:1 on a card
  primary: '#32CE8A', // a saturated green: 6.52:1 on a card, and still the document's hue
  primaryHover: '#45D89A',
  primaryActive: '#28B878',
  onPrimary: '#0F2118', // ink on the green fill
  primarySoft: '#1B3328',
  onPrimarySoft: '#7BE7B6',
  up: { main: '#32CE8A', soft: '#1B3328', onSoft: '#7BE7B6' },
  down: { main: '#F4747A', soft: '#3A2022', onSoft: '#F9AEB1' }, // the document's red, un-pastelled
  warning: { main: '#E0B95C', soft: '#3A2F1C' },
  info: { main: '#A8ADAB', soft: '#2B2F2D' },
  accent: { main: '#E0B95C', soft: '#3A2F1C' },
  nav: {
    // Lighter than the page, not darker: the bar lifts off a dark page the way it sinks into a light
    // one. The previous value was darker than the page and the two were 1.10:1 apart — no bar. This
    // one is a clear step (and lighter than the cards, so it is the most distinct band on screen).
    bg: '#3A3F3D',
    hover: '#454B48',
    text: '#FFFFFF', // 10.40:1 on the bar
    textMuted: '#C9CCCB', // 7.60:1
    active: '#45D89A', // 6.40:1
    cta: '#32CE8A', // 4.60:1 against the bar
    ctaText: '#0F2118', // 6.52:1 on the button
    field: '#1C1F1E', // an inset cavity in the bar, read by its outline
    fieldText: '#F1F1F1',
    fieldLabel: '#A8ADAB', // 7.55:1 on the field
    fieldBorder: 'rgba(241, 241, 241, 0.45)', // 4.30:1 composited over the bar
  },
  chart: {
    up: '#32CE8A',
    down: '#F4747A',
    gold: '#E0B95C',
    goldFill: 'rgba(224, 185, 92, 0.18)',
    grid: 'rgba(241, 241, 241, 0.12)',
    text: '#A8ADAB',
    volumeUp: 'rgba(50, 206, 138, 0.45)',
    volumeDown: 'rgba(244, 116, 122, 0.45)',
  },
  focusRing: '#45D89A',
  hoverWash: 'rgba(241, 241, 241, 0.06)',
  selectedWash: 'rgba(50, 206, 138, 0.16)',
};

export const tokensFor = (mode: PaletteMode): ModeTokens => (mode === 'dark' ? darkTokens : lightTokens);

/** Corner radii. Cards use `lg`, controls `md`, chips/pills `pill`. */
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

/** Motion. Short and purposeful: nothing over 320ms, nothing decorative. */
export const motion = {
  fast: '140ms',
  base: '200ms',
  slow: '320ms',
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export const layout = {
  headerHeight: 56,
  bottomNavHeight: 56,
  contentMaxWidth: 1440,
  gutterMobile: 16,
  gutterDesktop: 24,
} as const;

/**
 * Type scale, mapped onto MUI's variants by `createAppTheme`. Sizes are in rem so a user's
 * browser font-size preference still works; numerals use `tabular-nums` (see theme/components).
 */
export const typeScale = {
  display: { fontSize: '2rem', lineHeight: 1.25, fontWeight: 600, letterSpacing: '-0.022em' },
  h1: { fontSize: '1.5rem', lineHeight: 1.33, fontWeight: 600, letterSpacing: '-0.018em' },
  h2: { fontSize: '1.25rem', lineHeight: 1.4, fontWeight: 600, letterSpacing: '-0.01em' },
  h3: { fontSize: '1.0625rem', lineHeight: 1.41, fontWeight: 600 },
  body: { fontSize: '0.9375rem', lineHeight: 1.48, fontWeight: 400 },
  bodyStrong: { fontSize: '0.9375rem', lineHeight: 1.48, fontWeight: 600 },
  small: { fontSize: '0.8125rem', lineHeight: 1.4, fontWeight: 400 },
  smallStrong: { fontSize: '0.8125rem', lineHeight: 1.4, fontWeight: 600 },
  caption: { fontSize: '0.75rem', lineHeight: 1.35, fontWeight: 500 },
  label: { fontSize: '0.6875rem', lineHeight: 1.45, fontWeight: 600, letterSpacing: '0.06em' },
} as const;

/**
 * Elevation. Light mode carries real shadows; dark mode is flat by design — depth comes from
 * surface steps and hairlines, because shadows on near-black read as smudge.
 */
export const shadowsFor = (mode: PaletteMode): string[] => {
  const rest = new Array(20).fill('none');
  if (mode === 'dark') {
    return [
      'none',
      '0 1px 2px rgba(0, 0, 0, 0.4)',
      '0 2px 6px rgba(0, 0, 0, 0.45)',
      '0 8px 24px -8px rgba(0, 0, 0, 0.6)',
      '0 16px 40px -12px rgba(0, 0, 0, 0.7)',
      ...rest,
    ];
  }
  return [
    'none',
    '0 1px 2px rgba(51, 51, 51, 0.06), 0 1px 3px rgba(51, 51, 51, 0.08)',
    '0 2px 4px -1px rgba(51, 51, 51, 0.08), 0 4px 12px -2px rgba(51, 51, 51, 0.10)',
    '0 8px 24px -6px rgba(51, 51, 51, 0.16)',
    '0 16px 40px -12px rgba(51, 51, 51, 0.20)',
    ...rest,
  ];
};
