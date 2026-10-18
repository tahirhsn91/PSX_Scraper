import { Box, Chip, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface ShariahMeta {
  index: string;
  indexName: string;
  count: number;
  updatedAt: string | null;
  ageDays: number | null;
  stale: boolean;
  basis: string;
}

/**
 * The Shariah screen is index membership, and the control says so on its face.
 *
 * No ratio screen, no sector inference, no "Islamic" label bolted onto a stock the exchange has not
 * classified — those would be financial advice dressed as a filter. What this does is restrict to the
 * published KMI All Shares (Shariah) constituent list, cite it, and say when it was last read.
 */
export function ShariahToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { data } = useQuery({
    queryKey: ['market', 'shariah'],
    queryFn: async () => (await api.get<ShariahMeta>('/market/shariah')).data,
    staleTime: 60 * 60 * 1000,
  });

  const updated = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
    : null;

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip
          label={data ? `Shariah — KMI All Shares (${data.count})` : 'Shariah — KMI All Shares'}
          color={on ? 'primary' : 'default'}
          variant={on ? 'filled' : 'outlined'}
          onClick={onToggle}
          aria-pressed={on}
        />
        {data?.stale && (
          <Chip size="small" color="warning" variant="outlined" label="membership list is stale" />
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
        {data
          ? `${data.indexName} — published index membership${updated ? `, last read ${updated}` : ''}${
              data.ageDays != null ? ` (${data.ageDays} day${data.ageDays === 1 ? '' : 's'} ago)` : ''
            }. ${data.basis}`
          : 'Restricts to the published PSX KMI All Shares (Shariah) constituent list.'}
      </Typography>
    </Box>
  );
}
