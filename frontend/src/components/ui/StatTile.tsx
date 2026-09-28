import { ReactNode } from 'react';
import { Box, Card, CardActionArea, Stack, Typography, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export type StatTone = 'neutral' | 'up' | 'down' | 'warning' | 'muted';

export interface StatTileProps {
  /** Small uppercase label, e.g. "Tracked stocks". */
  label: string;
  /** The value itself. Already formatted by the caller (`formatNumber`, `formatCount`, …). */
  value: ReactNode;
  /** Optional second line: a `ChangePill`, a caption, or a hint. */
  footer?: ReactNode;
  tone?: StatTone;
  /** Optional leading icon. Decorative only — never the sole carrier of meaning. */
  icon?: ReactNode;
  /** Turns the whole tile into a link. Row-level navigation must be reachable by keyboard. */
  href?: string;
  /** Title attribute for the value, e.g. the unabbreviated figure. */
  valueTitle?: string;
}

/**
 * The KPI tile. One component for every metric row so cards stop being hand-rolled per page
 * (the audit found two different paddings and three different value sizes).
 */
export function StatTile({
  label,
  value,
  footer,
  tone = 'neutral',
  icon,
  href,
  valueTitle,
}: StatTileProps) {
  const theme = useTheme();
  const toneColor: string =
    tone === 'up'
      ? theme.palette.up.main
      : tone === 'down'
        ? theme.palette.down.main
        : tone === 'warning'
          ? theme.palette.warning.main
          : tone === 'muted'
            ? theme.palette.text.secondary
            : theme.palette.text.primary;

  const body = (
    <Stack spacing={0.5} sx={{ width: '100%' }}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
          {label}
        </Typography>
        {icon && (
          <Box sx={{ color: 'text.secondary', display: 'flex', '& svg': { fontSize: 18 } }} aria-hidden>
            {icon}
          </Box>
        )}
      </Stack>
      <Typography variant="h5" sx={{ color: toneColor, lineHeight: 1.2 }} title={valueTitle}>
        {value}
      </Typography>
      {footer && <Box>{footer}</Box>}
    </Stack>
  );

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {href ? (
        <CardActionArea component={RouterLink} to={href} sx={{ p: 1.5, height: '100%' }}>
          {body}
        </CardActionArea>
      ) : (
        <Box sx={{ p: 1.5, height: '100%' }}>{body}</Box>
      )}
    </Card>
  );
}
