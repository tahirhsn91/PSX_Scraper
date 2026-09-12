import { Box } from '@mui/material';

/**
 * Red "DEVELOPMENT ENVIRONMENT" strip so a dev build can never be mistaken for
 * production at a glance.
 *
 * Visibility is driven by Vite's own build-time flag: `import.meta.env.DEV` is
 * false in any `vite build` output, so the banner can only ever appear on a dev
 * server — it is dead-code-eliminated from a production bundle. Set
 * `VITE_SHOW_ENV_BANNER=true` to force it on anyway (e.g. a staging stack that
 * is a production build but must still be labelled).
 */
const showBanner = import.meta.env.DEV || import.meta.env.VITE_SHOW_ENV_BANNER === 'true';

const label = import.meta.env.VITE_ENV_LABEL ?? 'DEVELOPMENT ENVIRONMENT';

export function EnvBanner() {
  if (!showBanner) return null;
  return (
    <Box
      role="status"
      aria-label={label}
      sx={{
        // Hard-coded, theme-independent colours: this must stay red-on-white in
        // both light and dark mode, so it never blends into the app chrome.
        backgroundColor: '#c62828',
        color: '#ffffff',
        textAlign: 'center',
        py: 0.5,
        px: 2,
        fontSize: '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1.6,
      }}
    >
      {label}
    </Box>
  );
}
