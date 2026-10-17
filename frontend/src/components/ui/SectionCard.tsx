import { ReactNode } from 'react';
import { Box, Card, Divider, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { Reveal } from './Reveal';

export interface SectionCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-hand control: a button, a filter, a count chip. */
  action?: ReactNode;
  children: ReactNode;
  /** Drop the body padding so a table can meet the card edges. */
  flush?: boolean;
  sx?: SxProps<Theme>;
  /**
   * Fade and lift this card as it scrolls into view. Opt-in, because it adds a wrapper element —
   * harmless for a card in normal flow, but it would break the `height: 100%` stretch of a card
   * that is itself a grid item, so those callers must not use it.
   */
  reveal?: boolean;
}

/** A titled surface. Every page section is one of these, so headers and edges match everywhere. */
export function SectionCard({ title, subtitle, action, children, flush = false, sx, reveal = false }: SectionCardProps) {
  const hasHeader = Boolean(title || subtitle || action);
  const card = (
    <Card variant="outlined" sx={{ display: 'flex', flexDirection: 'column', ...sx }}>
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
      <Box sx={{ p: flush ? 0 : 1.5, flexGrow: 1, minHeight: 0 }}>{children}</Box>
    </Card>
  );

  return reveal ? <Reveal>{card}</Reveal> : card;
}
