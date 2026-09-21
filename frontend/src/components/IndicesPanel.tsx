import { Box, Card, CardContent, Grid, Typography } from '@mui/material';
import type { IndexSummary } from '../types';

/**
 * The PSX index board across the top of the dashboard.
 *
 * Every index the exchange publishes, taking the level and the exchange's own change figures
 * as reported — a missing reading renders as a dash rather than a zero, so an index the page
 * did not quote is visible as unknown instead of looking flat.
 */
export function IndicesPanel({ indices }: { indices: IndexSummary[] | undefined }) {
  if (!indices || indices.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        PSX indices ({indices.length})
      </Typography>
      <Grid container spacing={1}>
        {indices.map((index) => {
          const change = index.change;
          const tone = change === null ? 'text.secondary' : change > 0 ? 'success.main' : change < 0 ? 'error.main' : 'text.secondary';
          const arrow = change === null ? '' : change > 0 ? '▲' : change < 0 ? '▼' : '·';
          return (
            <Grid item xs={6} sm={4} md={3} lg={2} key={index.symbol}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                  <Typography variant="caption" color="text.secondary" noWrap display="block" title={index.name}>
                    {index.name}
                  </Typography>
                  <Typography variant="body2" fontWeight={700} noWrap>
                    {index.symbol}
                  </Typography>
                  <Typography variant="h6" sx={{ fontSize: 16, lineHeight: 1.2 }}>
                    {index.value === null ? '—' : index.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </Typography>
                  <Typography variant="caption" sx={{ color: tone }}>
                    {change === null
                      ? '—'
                      : `${arrow} ${change.toFixed(2)}${index.changePercent === null ? '' : ` (${index.changePercent.toFixed(2)}%)`}`}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
