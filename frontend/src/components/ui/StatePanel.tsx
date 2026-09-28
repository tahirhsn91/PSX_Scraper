import { ReactNode } from 'react';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';

export type StateKind = 'empty' | 'error' | 'loading';

export interface StatePanelProps {
  kind: StateKind;
  title?: string;
  description?: ReactNode;
  /** A clear next action: "Add a stock", "Try again". */
  action?: ReactNode;
  /** Override the default icon. */
  icon?: ReactNode;
  /** Inline variant, for use inside a card or table body. */
  compact?: boolean;
}

const DEFAULTS: Record<StateKind, { title: string; icon: ReactNode }> = {
  empty: { title: 'Nothing here yet', icon: <InboxOutlinedIcon fontSize="inherit" /> },
  error: { title: 'Something went wrong', icon: <ErrorOutlineIcon fontSize="inherit" /> },
  loading: { title: 'Loading…', icon: <CircularProgress size={20} thickness={5} /> },
};

/**
 * One component for all three non-happy states, so empty/error/loading stop looking like four
 * different apps (the audit counted six empty-state idioms and four loading ones). Errors are
 * announced (`role="alert"`), loading sections are marked busy for assistive tech.
 */
export function StatePanel({ kind, title, description, action, icon, compact = false }: StatePanelProps) {
  const fallback = DEFAULTS[kind];
  const color = kind === 'error' ? 'error.main' : 'text.secondary';

  return (
    <Stack
      role={kind === 'error' ? 'alert' : 'status'}
      aria-busy={kind === 'loading' || undefined}
      spacing={compact ? 0.75 : 1.25}
      alignItems="center"
      justifyContent="center"
      sx={{
        textAlign: 'center',
        py: compact ? 2.5 : 5,
        px: 2,
        color,
      }}
    >
      <Box sx={{ display: 'flex', fontSize: compact ? 22 : 30, color }} aria-hidden>
        {icon ?? fallback.icon}
      </Box>
      <Typography variant={compact ? 'body2' : 'subtitle1'} sx={{ color: 'text.primary' }}>
        {title ?? fallback.title}
      </Typography>
      {description && (
        <Typography variant="body2" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 0.5 }}>{action}</Box>}
    </Stack>
  );
}

/** Convenience wrapper: an error panel with a retry button, used by every data-backed section. */
export function ErrorPanel({
  message = 'We could not load this data.',
  onRetry,
  compact,
}: {
  message?: ReactNode;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <StatePanel
      kind="error"
      title="Could not load this data"
      description={message}
      compact={compact}
      action={
        onRetry ? (
          <Button size="small" variant="outlined" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
