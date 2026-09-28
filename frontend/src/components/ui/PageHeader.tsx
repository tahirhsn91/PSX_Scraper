import { ReactNode } from 'react';
import { Box, Breadcrumbs, Link as MuiLink, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export interface Crumb {
  label: string;
  /** Omit on the current page (the last crumb). */
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Trail rendered above the title, e.g. Dashboard › Stock. */
  crumbs?: Crumb[];
  /** Primary page actions, right-aligned on desktop, full-width row on phones. */
  actions?: ReactNode;
  /** Small line under the subtitle: last-sync chips, notices. */
  meta?: ReactNode;
}

/**
 * One page-header pattern for every screen: breadcrumb, an actual `<h1>`, an optional subtitle and
 * the page's actions in a predictable place. The audit found five pages using five different
 * arrangements and no `<h1>` anywhere.
 */
export function PageHeader({ title, subtitle, crumbs, actions, meta }: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 1.5, sm: 2 }}
      alignItems={{ xs: 'stretch', sm: 'flex-start' }}
      justifyContent="space-between"
      sx={{ mb: 2.5 }}
    >
      <Box sx={{ minWidth: 0 }}>
        {crumbs && crumbs.length > 0 && (
          <Breadcrumbs
            aria-label="Breadcrumb"
            sx={{ mb: 0.5, '& .MuiBreadcrumbs-separator': { mx: 0.5 } }}
          >
            {crumbs.map((c) =>
              c.to ? (
                <MuiLink key={c.label} component={RouterLink} to={c.to} variant="body2">
                  {c.label}
                </MuiLink>
              ) : (
                <Typography key={c.label} variant="body2" color="text.secondary">
                  {c.label}
                </Typography>
              ),
            )}
          </Breadcrumbs>
        )}
        <Typography variant="h4" component="h1" sx={{ wordBreak: 'break-word' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
        {meta && <Box sx={{ mt: 1 }}>{meta}</Box>}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
