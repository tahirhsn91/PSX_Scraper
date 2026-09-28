import type { Components, Theme } from '@mui/material/styles';
import { layout, motion, radius } from './tokens';

/**
 * Component defaults. Anything visual that repeats across pages belongs here rather than in a
 * page's `sx`, so a change lands everywhere at once.
 */
export const componentsFor = (theme: Theme): Components<Theme> => {
  const isDark = theme.palette.mode === 'dark';
  const t = theme.palette;

  return {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          colorScheme: theme.palette.mode,
          // Native scrollbars, form controls and autofill follow the theme.
          accentColor: t.primary.main,
        },
        html: { WebkitTextSizeAdjust: '100%' },
        body: {
          backgroundColor: t.background.default,
          color: t.text.primary,
          // Theme switches cross-fade instead of snapping; motion is opt-out via the media query below.
          transition: `background-color ${motion.base} ${motion.easing}, color ${motion.base} ${motion.easing}`,
        },
        '*': { boxSizing: 'border-box' },
        '::selection': { backgroundColor: t.selectedWash },
        // Keyboard focus has to be visible on every control, including the ones MUI renders without
        // a ring (table sort labels, chips, links inside cards). Mouse clicks stay quiet.
        ':focus-visible': {
          outline: `2px solid ${t.primary.main}`,
          outlineOffset: 2,
          borderRadius: 4,
        },
        '@media (prefers-reduced-motion: reduce)': {
          '*': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      },
    },

    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'transparent' },
      styleOverrides: {
        root: {
          backgroundColor: t.background.default,
          backgroundImage: 'none',
          borderBottom: `1px solid ${t.divider}`,
          color: t.text.primary,
        },
      },
    },

    MuiToolbar: {
      styleOverrides: {
        root: {
          minHeight: layout.headerHeight,
          '@media (min-width: 600px)': { minHeight: layout.headerHeight },
          gap: 8,
        },
      },
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: t.divider },
      },
    },

    MuiCard: {
      defaultProps: { variant: 'outlined', elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: radius.lg,
          borderColor: t.divider,
          backgroundColor: t.background.paper,
        },
      },
    },

    MuiCardContent: {
      styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } },
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: radius.md,
          fontWeight: 600,
          letterSpacing: 0,
          minHeight: 40,
          paddingInline: 16,
          transition: `background-color ${motion.fast} ${motion.easing}, border-color ${motion.fast} ${motion.easing}, color ${motion.fast} ${motion.easing}`,
        },
        sizeSmall: { minHeight: 32, paddingInline: 12, fontSize: '0.8125rem' },
        sizeLarge: { minHeight: 46, fontSize: '0.9375rem' },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        outlined: { borderColor: t.borderStrong ?? t.divider },
        text: { '&:hover': { backgroundColor: t.action.hover } },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: radius.md,
          // 44x44 touch target with a 40px visual box.
          minWidth: 44,
          minHeight: 44,
          color: 'inherit',
          '&:hover': { backgroundColor: t.action.hover },
        },
        sizeSmall: { minWidth: 36, minHeight: 36 },
      },
    },

    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.8125rem',
          borderRadius: radius.sm,
          borderColor: t.divider,
          color: t.text.secondary,
          paddingBlock: 4,
          paddingInline: 10,
          minHeight: 32,
          '&.Mui-selected': {
            backgroundColor: t.selectedWash,
            color: t.primary.main,
            borderColor: t.primary.main,
            '&:hover': { backgroundColor: t.selectedWash },
          },
        },
      },
    },

    MuiToggleButtonGroup: {
      styleOverrides: {
        root: { gap: 4, '& .MuiToggleButtonGroup-grouped': { border: `1px solid ${t.divider}`, marginLeft: 0 } },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { borderRadius: radius.pill, fontWeight: 600, fontSize: '0.75rem' },
        sizeSmall: { height: 22, fontSize: '0.6875rem' },
      },
    },

    MuiTable: {
      styleOverrides: { root: { borderCollapse: 'separate', borderSpacing: 0 } },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${t.divider}`,
          paddingBlock: 10,
          paddingInline: 12,
          // Figures line up column-wise.
          fontVariantNumeric: 'tabular-nums',
        },
        head: {
          position: 'sticky',
          top: 0,
          zIndex: 2,
          backgroundColor: t.background.paper,
          color: t.text.secondary,
          fontWeight: 600,
          fontSize: '0.6875rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        },
        sizeSmall: { paddingBlock: 6, paddingInline: 10 },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-child td': { borderBottom: 0 },
          transition: `background-color ${motion.fast} ${motion.easing}`,
          // Hover lives on the state class so it only applies to rows with `hover`.
          '&.MuiTableRow-hover:hover': { backgroundColor: t.action.hover },
        },
      },
    },

    MuiTableContainer: {
      styleOverrides: { root: { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } },
    },

    MuiTablePagination: {
      styleOverrides: {
        root: { borderTop: `1px solid ${t.divider}`, minHeight: 48 },
        selectLabel: { fontSize: '0.8125rem' },
        displayedRows: { fontSize: '0.8125rem', margin: 0 },
      },
    },

    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44, borderBottom: `1px solid ${t.divider}` },
        indicator: { height: 2, borderRadius: 2 },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          minHeight: 44,
          minWidth: 0,
          paddingInline: 14,
          transition: `color ${motion.fast} ${motion.easing}`,
        },
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: radius.md,
          backgroundColor: isDark ? t.background.paper : t.background.paper,
          transition: `border-color ${motion.fast} ${motion.easing}, box-shadow ${motion.fast} ${motion.easing}`,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: t.divider },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: t.borderStrong ?? t.divider },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: t.primary.main,
            borderWidth: 2,
          },
          '&.Mui-focused': { boxShadow: `0 0 0 3px ${t.selectedWash}` },
        },
        input: { fontVariantNumeric: 'tabular-nums' },
      },
    },

    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.875rem' } } },

    MuiFormHelperText: { styleOverrides: { root: { marginLeft: 2, fontSize: '0.75rem' } } },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: radius.lg,
          border: `1px solid ${t.divider}`,
          backgroundImage: 'none',
        },
      },
    },

    MuiDialogTitle: { styleOverrides: { root: { fontSize: '1.0625rem', fontWeight: 600 } } },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: isDark ? t.surfaceElevated ?? t.background.paper : '#0F172A',
          color: '#FFFFFF',
          borderRadius: radius.sm,
          fontSize: '0.75rem',
          paddingBlock: 6,
          paddingInline: 10,
        },
        arrow: { color: isDark ? t.surfaceElevated ?? t.background.paper : '#0F172A' },
      },
    },

    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: radius.md, border: '1px solid', alignItems: 'center' },
        standardSuccess: { backgroundColor: t.success.soft ?? t.background.paper, borderColor: t.success.main, color: t.text.primary },
        standardError: { backgroundColor: t.error.soft ?? t.background.paper, borderColor: t.error.main, color: t.text.primary },
        standardWarning: { backgroundColor: t.warning.soft, borderColor: t.warning.main, color: t.text.primary },
        standardInfo: { backgroundColor: t.info.soft, borderColor: t.info.main, color: t.text.primary },
      },
    },

    MuiSnackbarContent: {
      styleOverrides: {
        root: {
          borderRadius: radius.md,
          backgroundColor: isDark ? t.surfaceElevated ?? t.background.paper : '#0F172A',
          color: '#FFFFFF',
          border: `1px solid ${t.divider}`,
        },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 6, borderRadius: radius.pill, backgroundColor: t.action.hover },
        bar: { borderRadius: radius.pill },
      },
    },

    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
      styleOverrides: {
        root: { backgroundColor: isDark ? 'rgba(232, 238, 248, 0.08)' : 'rgba(15, 23, 42, 0.07)' },
        rounded: { borderRadius: radius.md },
      },
    },

    MuiDivider: { styleOverrides: { root: { borderColor: t.divider } } },

    MuiLink: {
      defaultProps: { underline: 'hover' },
      styleOverrides: { root: { color: t.primary.main, fontWeight: 600 } },
    },

    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: radius.md, '&.Mui-selected': { backgroundColor: t.selectedWash } } },
    },

    MuiPopover: { styleOverrides: { paper: { borderRadius: radius.md, border: `1px solid ${t.divider}` } } },

    MuiMenu: { styleOverrides: { paper: { borderRadius: radius.md, border: `1px solid ${t.divider}` } } },

    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${t.divider}`,
          borderRadius: `${radius.md}px !important`,
          '&:before': { display: 'none' },
          '&.Mui-expanded': { margin: 0 },
        },
      },
    },

    MuiBadge: { styleOverrides: { badge: { fontWeight: 600, fontVariantNumeric: 'tabular-nums' } } },

    MuiTypography: {
      styleOverrides: {
        gutterBottom: { marginBottom: 8 },
      },
    },
  };
};
