import { ReactNode } from 'react';
import { Box, Card, Divider, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export interface SectionCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-hand control: a button, a filter, a count chip. */
  action?: ReactNode;
  children: ReactNode;
  /** Drop the body padding so a table can meet the card edges. */
  flush?: boolean;
  sx?: SxProps<Theme>;
}

/** A titled surface. Every page section is one of these, so headers and edges match everywhere. */
export function SectionCard({ title, subtitle, action, children, flush = false, sx }: SectionCardProps) {
  const hasHeader = Boolean(title || subtitle || action);
  return (
    <Card variant="outlined" sx={sx}>
      {hasHeader && (
        <>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1.5}
            useFlexGap
            sx={{ p: 1.5, flexWrap: 'wrap' }}
          >
            <Box sx={{ minWidth: 0 }}>
              {title && (
                <Typography variant="h6" component="h2">
                  {title}
                </Typography>
              )}
              {subtitle && (
                <Typography variant="body2" color="text.secondary">
                  {subtitle}
                </Typography>
              )}
            </Box>
            {action}
          </Stack>
          <Divider />
        </>
      )}
      <Box sx={{ p: flush ? 0 : 1.5 }}>{children}</Box>
    </Card>
  );
}
