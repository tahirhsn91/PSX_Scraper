import type { PaletteMode } from '@mui/material';

/**
 * Design tokens — the single source of truth for the app's visual language.
 *
 * Every colour pair here was contrast-checked with WCAG 2.1 relative luminance before being
 * committed (ratios in the comments). Components must read these through the MUI theme
 * (`theme.palette.*`) rather than importing literals, so light and dark stay in step.
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
  focusRing: string;
  /** Alpha used by dividers/hover washes that must not fight the surface. */
  hoverWash: string;
  selectedWash: string;
}

export const lightTokens: ModeTokens = {
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  sunken: '#EDF1F6',
  border: '#D8E0E9',
  borderStrong: '#7B8A9C', // 3.52:1 on white
  text: '#0F172A', // 17.85:1 on surface
  textSecondary: '#4A5A6E', // 7.05:1
  textMuted: '#5A6A7D', // 5.54:1
  primary: '#0B7A50', // 5.37:1 against white text
  primaryHover: '#096440',
  primaryActive: '#075435',
  onPrimary: '#FFFFFF',
  primarySoft: '#E3F3EB',
  onPrimarySoft: '#146C34', // 5.83:1 on primarySoft
  up: { main: '#15803D', soft: '#E7F6EC', onSoft: '#146C34' }, // 5.02:1 / 5.83:1
  down: { main: '#C81E1E', soft: '#FDECEC', onSoft: '#A31515' }, // 5.74:1 / 6.4:1
  warning: { main: '#B45309', soft: '#FDF3E7' }, // 5.02:1
  info: { main: '#0B5FA5', soft: '#E8F1FA' }, // 6.57:1
  accent: { main: '#B45309', soft: '#FDF3E7' },
  focusRing: '#0B7A50', // 5.37:1 against the light background
  hoverWash: 'rgba(15, 23, 42, 0.04)',
  selectedWash: 'rgba(11, 122, 80, 0.08)',
};

export const darkTokens: ModeTokens = {
  bg: '#0B1220',
  surface: '#131C2E',
  surfaceElevated: '#1A2438',
  sunken: '#070C16',
  border: '#2E3D57', // hairline separator
  borderStrong: '#7C8BA0', // 4.91:1 on surface (>= 3:1 for control outlines)
  text: '#E8EEF8', // 14.61:1 on surface
  textSecondary: '#A9B6C9', // 8.29:1
  textMuted: '#7C8BA0', // 4.91:1
  primary: '#34D399', // 8.86:1 as text on surface
  primaryHover: '#4BE0AC',
  primaryActive: '#22C58A',
  onPrimary: '#04231A', // 8.67:1 on primary
  primarySoft: '#10291D',
  onPrimarySoft: '#7CE3B0',
  up: { main: '#4ADE80', soft: '#10291D', onSoft: '#86EFAC' }, // 9.77:1 / 8.88:1
  down: { main: '#F87171', soft: '#2A1113', onSoft: '#FCA5A5' }, // 6.16:1 / 6.39:1
  warning: { main: '#FBBF24', soft: '#2E2410' }, // 10.2:1
  info: { main: '#60A5FA', soft: '#12243B' }, // 6.70:1
  accent: { main: '#F59E0B', soft: '#2E2410' },
  focusRing: '#34D399', // 9.74:1 against the dark background
  hoverWash: 'rgba(232, 238, 248, 0.06)',
  selectedWash: 'rgba(52, 211, 153, 0.12)',
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
    '0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08)',
    '0 2px 4px -1px rgba(15, 23, 42, 0.08), 0 4px 12px -2px rgba(15, 23, 42, 0.10)',
    '0 8px 24px -6px rgba(15, 23, 42, 0.16)',
    '0 16px 40px -12px rgba(15, 23, 42, 0.20)',
    ...rest,
  ];
};
