import { Box, useTheme } from '@mui/material';
import { GLYPH, formatPercent, trendOf } from '../../lib/format';
import { useFlashTrigger } from './LiveNumber';

export interface ChangePillProps {
  /** Percentage change, e.g. `1.07` for +1.07%. `null` renders the dash, uncoloured. */
  value: number | null | undefined;
  /** `solid` (default, high emphasis) or `soft` (tinted, for dense tables). */
  variant?: 'solid' | 'soft';
  size?: 'sm' | 'md';
  /** The ▲/▼/· glyph: direction must never be carried by colour alone. */
  showGlyph?: boolean;
  /** Optional tooltip, e.g. the absolute change behind the percentage. */
  title?: string;
  /**
   * Pop the pill when the percentage changes. Off by default: most callers (a stock page, a
   * screener result) render a value that is not being polled under the reader, and a pill that
   * jumps on mount would say "this moved" when nothing did.
   */
  flash?: boolean;
}

/**
 * Direction pill. Every colour pair used here was contrast-verified (see `theme/tokens.ts`) and the
 * glyph duplicates the colour signal for colour-blind users and greyscale printing.
 */
export function ChangePill({
  value,
  variant = 'solid',
  size = 'sm',
  showGlyph = true,
  title,
  flash = false,
}: ChangePillProps) {
  const theme = useTheme();
  const flashState = useFlashTrigger(value, flash);
  const trend = trendOf(value);
  const trendColors = trend === 'up' ? theme.palette.up : trend === 'down' ? theme.palette.down : null;
  const contrastText = trend === 'up' ? theme.palette.success.contrastText : theme.palette.error.contrastText;

  const backgroundColor =
    trendColors == null
      ? theme.palette.action.hover
      : variant === 'solid'
        ? trendColors.main
        : trendColors.soft;
  const color =
    trendColors == null
      ? theme.palette.text.secondary
      : variant === 'solid'
        ? (contrastText ?? theme.palette.getContrastText(trendColors.main))
        : trendColors.onSoft;

  return (
    <Box
      component="span"
      key={flashState?.key ?? 'steady'}
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
        px: size === 'md' ? 1 : 0.75,
        minWidth: size === 'md' ? 72 : 64,
        height: size === 'md' ? 24 : 20,
        borderRadius: `${theme.app.radii.pill}px`,
        backgroundColor,
        color,
        fontSize: size === 'md' ? '0.8125rem' : '0.75rem',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        transition: `background-color ${theme.app.motion.fast} ${theme.app.motion.easing}, color ${theme.app.motion.fast} ${theme.app.motion.easing}`,
        // A flash is a pop, not a wash: the pill already carries its own tint, so a background
        // animation would fight it. Transform only, so the cell never reflows.
        animation: flashState == null ? undefined : `pill-pop 300ms ${theme.app.motion.easing}`,
        '@keyframes pill-pop': {
          '0%': { transform: 'scale(1.08)' },
          '100%': { transform: 'none' },
        },
      }}
    >
      {showGlyph && trend && (
        <Box component="span" aria-hidden sx={{ fontSize: '0.7em', lineHeight: 1 }}>
          {GLYPH[trend]}
        </Box>
      )}
      {formatPercent(value)}
    </Box>
  );
}
