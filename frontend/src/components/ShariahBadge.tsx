import { Box, Chip, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface Meta {
  indexName: string;
  updatedAt: string | null;
  basis: string;
  member?: boolean;
}

/**
 * "Member of the KMI All Shares (Shariah) index" — the classification, cited.
 *
 * Shown only when the stock *is* a constituent. Absence from the index is not a statement that a
 * company is non-compliant, and rendering "not Shariah" from a missing row would turn an index's
 * scope into a religious ruling.
 */
export function ShariahBadge({ symbol }: { symbol: string }) {
  const { data } = useQuery({
    queryKey: ['market', 'shariah', symbol],
    queryFn: async () => (await api.get<Meta>('/market/shariah', { params: { symbol } })).data,
    staleTime: 60 * 60 * 1000,
  });
  if (!data?.member) return null;

  const updated = data.updatedAt
    ? new Date(data.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
    : null;

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" color="success" variant="outlined" label={`${data.indexName} constituent`} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Membership of a published PSX Shariah index{updated ? `, list last read ${updated}` : ''}.{' '}
        {data.basis} Absence from this index does not assert that a company is non-compliant.
      </Typography>
    </Box>
  );
}
