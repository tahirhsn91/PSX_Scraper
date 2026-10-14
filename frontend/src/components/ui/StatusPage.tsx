import { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { EnvBanner } from '../EnvBanner';

export interface StatusPageProps {
  /** The large mark: a status code (`404`), or a glyph when there is no code to quote. */
  code: ReactNode;
  title: string;
  description: ReactNode;
  /** Primary ways out of this state. */
  actions?: ReactNode;
  /**
   * Render as a page in its own right rather than as a panel inside the app shell.
   *
   * The crash fallback needs this: `ErrorBoundary` sits *above* `BrowserRouter` and `Layout`, so
   * when it triggers there is no header, no navigation and no router — the page has to stand up on
   * its own, including the brand. The 404 renders inside the shell and leaves this off.
   */
  standalone?: boolean;
  /**
   * Technical detail, collapsed by default. Anything a reader could be shown by accident belongs
   * in here — an uncaught error's message is written for a developer, not for a customer.
   */
  detail?: ReactNode;
}

/**
 * The brand lockup, copied in spirit from `AppHeader` but on a page surface rather than the dark bar.
 *
 * A plain anchor, not a `RouterLink`: the one place this renders is the crash fallback, which sits
 * *above* `BrowserRouter` — a router link there would throw inside the boundary that caught the
 * original error. It is only shown when `standalone`, so nothing here depends on the router.
 */
function BrandMark() {
  return (
    <Box
      component="a"
      href="/"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 2,
        color: 'text.primary',
        textDecoration: 'none',
      }}
    >
      {/* Decorative: the wordmark sits beside it, so an empty alt stops a screen reader reading
          the mark out as well. */}
      <Box
        component="img"
        src="/logo-64.png"
        alt=""
        aria-hidden
        sx={{ width: 36, height: 36, display: 'block', flexShrink: 0 }}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          MyPortfolio365
        </Typography>
        <Typography
          component="span"
          sx={{
            mt: 0.25,
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'text.secondary',
            textAlign: 'center',
          }}
        >
          Market
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * One surface for "the app cannot show you this": a 404, a crash, anything terminal.
 *
 * Built rather than reusing `StatePanel`, which is sized for a card body — its job is to say
 * "this list is empty", and a whole page wearing an empty-list panel is how the old 404 read.
 */
export function StatusPage({
  code,
  title,
  description,
  actions,
  standalone = false,
  detail,
}: StatusPageProps) {
  return (
    <Box
      sx={{
        // `dvh`, not `vh`: on a phone `vh` is the viewport with the browser chrome hidden, which
        // pushes a centred column off the bottom edge.
        minHeight: standalone ? '100dvh' : undefined,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
      // The standalone page *is* the main region. In the shell `Layout` already supplies the
      // landmark, and a second `<main>` would be invalid.
      component={standalone ? 'main' : 'div'}
    >
      {/* Kept on the crash page on purpose: it is how the dev environment is told from production
          at a glance, and losing that signal is exactly when it is most needed. Dead code in a
          production build, since the banner is gated on `import.meta.env.DEV`. */}
      {standalone && <EnvBanner />}

      <Stack
        spacing={1.5}
        alignItems="center"
        justifyContent="center"
        sx={{
          flex: standalone ? 1 : undefined,
          mx: 'auto',
          width: '100%',
          maxWidth: 560,
          textAlign: 'center',
          px: 2,
          py: standalone ? 6 : 7,
        }}
      >
        {standalone && <BrandMark />}

        <Box
          sx={{
            fontSize: { xs: '3rem', sm: '3.75rem' },
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-0.03em',
            color: 'primary.main',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {code}
        </Box>

        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 460 }}>
          {description}
        </Typography>

        {actions && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            useFlexGap
            sx={{ pt: 1.5, width: { xs: '100%', sm: 'auto' } }}
          >
            {actions}
          </Stack>
        )}
      </Stack>

      {detail && (
        <Box sx={{ width: '100%', maxWidth: 720, mx: 'auto', px: 2, pb: 6 }}>{detail}</Box>
      )}
    </Box>
  );
}
