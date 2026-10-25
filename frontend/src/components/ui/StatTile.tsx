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
  /** Stretch the tile's content so the label+value sit at the top and the footer at the bottom. */
  fill?: boolean;
  /** Center the label, value and footer and render the value at the hero size. */
  centered?: boolean;
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
  fill = false,
  centered = false,
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
    <Stack
      spacing={0.5}
      sx={{ width: '100%', ...(fill ? { height: '100%', justifyContent: 'space-between' } : {}) }}
    >
      <Stack direction="row" spacing={1} alignItems="center" justifyContent={centered ? 'center' : 'space-between'}>
        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
          {label}
        </Typography>
        {icon && (
          <Box sx={{ color: 'text.secondary', display: 'flex', '& svg': { fontSize: 18 } }} aria-hidden>
            {icon}
          </Box>
        )}
      </Stack>
      <Typography
        variant={centered ? 'h1' : 'h5'}
        // A KPI value is data, not a heading. Rendering it as h1 put seven level-one headings on
        // the dashboard (the page title plus six breadth tiles) and made heading navigation
        // meaningless; the visual size is kept, the outline is not.
        component="p"
        sx={{ color: toneColor, lineHeight: 1.2, m: 0, ...(centered ? { textAlign: 'center' } : {}) }}
        title={valueTitle}
      >
        {value}
      </Typography>
      {footer && <Box sx={{ ...(centered ? { textAlign: 'center' } : {}) }}>{footer}</Box>}
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
