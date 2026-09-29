import { createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';
import {
  layout,
  motion,
  radius,
  shadowsFor,
  tokensFor,
  typeScale,
  type ChartColors,
  type ModeTokens,
  type NavColors,
  type SoftColor,
  type TrendColors,
} from './tokens';
import { componentsFor } from './components';

/**
 * Theme extras. MUI's palette has no slot for surfaces or trend pairs, so we widen it once here
 * and every component reads the same tokens (`theme.palette.up.main`, `theme.palette.surfaceElevated`).
 * Non-palette values hang off a single `app` key so they cannot collide with MUI's own theme keys.
 */
export interface AppThemeExtras {
  layout: typeof layout;
  motion: typeof motion;
  radii: typeof radius;
  tokens: ModeTokens;
}

declare module '@mui/material/styles' {
  interface PaletteColor {
    /** Tinted background for soft pills/banners. */
    soft?: string;
    /** Text colour that sits on `soft`. */
    onSoft?: string;
  }
  interface SimplePaletteColorOptions {
    soft?: string;
    onSoft?: string;
  }
  interface Palette {
    surfaceElevated: string;
    sunken: string;
    borderStrong: string;
    selectedWash: string;
    hoverWash: string;
    focusRing: string;
    up: TrendColors;
    down: TrendColors;
    accent: SoftColor;
    nav: NavColors;
    chart: ChartColors;
  }
  interface PaletteOptions {
    surfaceElevated?: string;
    sunken?: string;
    borderStrong?: string;
    selectedWash?: string;
    hoverWash?: string;
    focusRing?: string;
    up?: TrendColors;
    down?: TrendColors;
    accent?: SoftColor;
    nav?: NavColors;
    chart?: ChartColors;
  }
  interface Theme {
    app: AppThemeExtras;
  }
  interface ThemeOptions {
    app?: AppThemeExtras;
  }
}

const fontFamily = [
  '"Plus Jakarta Sans"',
  'system-ui',
  '-apple-system',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(', ');

/**
 * Builds the app theme for a mode.
 *
 * MUI's variant names are mapped from the token scale. The screens use h4/h5/h6 today (page title,
 * KPI value, section heading), so those carry the sizes that matter, and h1-h3 stay available for
 * hero treatments:
 *   h1 -> display (32) · h2 -> h1 (24) · h3 -> h2 (20) · h4 -> page title (24) · h5 -> KPI (20)
 *   h6 -> section (17) · subtitle1 -> body strong (15) · body1 -> body (15) · body2 -> small (13)
 *   caption (12) · overline -> label (11, uppercase)
 */
function buildOptions(mode: PaletteMode): ThemeOptions {
  const t = tokensFor(mode);
  const isDark = mode === 'dark';
  // Ink that sits on a saturated trend fill: dark in dark mode (the fills there are pastels),
  // white in light mode.
  const onTrend = isDark ? t.onPrimary : '#FFFFFF';

  return {
    palette: {
      mode,
      primary: {
        main: t.primary,
        dark: t.primaryActive,
        light: t.primaryHover,
        contrastText: t.onPrimary,
      },
      secondary: {
        main: t.info.main,
        contrastText: isDark ? t.onPrimary : '#FFFFFF',
      },
      success: { main: t.up.main, soft: t.up.soft, onSoft: t.up.onSoft, contrastText: onTrend },
      error: {
        main: t.down.main,
        soft: t.down.soft,
        onSoft: t.down.onSoft,
        contrastText: onTrend,
      },
      warning: { main: t.warning.main, soft: t.warning.soft, contrastText: isDark ? '#E8E2D2' : '#FFFFFF' },
      info: { main: t.info.main, soft: t.info.soft, contrastText: isDark ? t.onPrimary : '#FFFFFF' },
      background: { default: t.bg, paper: t.surface },
      text: { primary: t.text, secondary: t.textSecondary, disabled: t.textMuted },
      divider: t.border,
      action: {
        hover: t.hoverWash,
        selected: t.selectedWash,
        focus: t.selectedWash,
        disabled: t.textMuted,
        disabledBackground: t.sunken,
      },
      surfaceElevated: t.surfaceElevated,
      sunken: t.sunken,
      borderStrong: t.borderStrong,
      selectedWash: t.selectedWash,
      hoverWash: t.hoverWash,
      focusRing: t.focusRing,
      up: t.up,
      down: t.down,
      accent: t.accent,
      nav: t.nav,
      chart: t.chart,
    },
    typography: {
      fontFamily,
      h1: typeScale.display,
      h2: typeScale.h1,
      h3: typeScale.h2,
      h4: typeScale.h1,
      h5: typeScale.h2,
      h6: typeScale.h3,
      subtitle1: typeScale.bodyStrong,
      subtitle2: typeScale.smallStrong,
      body1: typeScale.body,
      body2: typeScale.small,
      caption: typeScale.caption,
      overline: { ...typeScale.label, textTransform: 'uppercase' },
      button: {
        fontSize: '0.875rem',
        lineHeight: 1.4,
        fontWeight: 600,
        letterSpacing: 0,
        textTransform: 'none',
      },
    },
    shape: { borderRadius: radius.md },
    shadows: shadowsFor(mode) as unknown as Theme['shadows'],
    transitions: {
      duration: { shortest: 120, shorter: 160, short: 200, standard: 240, complex: 320 },
      easing: { easeOut: motion.easing },
    },
    app: { layout, motion, radii: radius, tokens: t },
  };
}

export function createAppTheme(mode: PaletteMode): Theme {
  const options = buildOptions(mode);
  // Two passes: component overrides are derived from the theme itself (mode-dependent borders,
  // washes, shadows), so the base theme has to exist before they are computed.
  const base = createTheme(options);
  return createTheme({ ...options, components: componentsFor(base) });
}

export { tokensFor as modeTokens, tokensFor, radius, motion, layout, typeScale } from './tokens';
export type { ModeTokens, TrendColors, SoftColor } from './tokens';
