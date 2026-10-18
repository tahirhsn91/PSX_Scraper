import { useMemo } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  Container,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useAnnouncements } from '../api/hooks';
import { SectionCard } from '../components/ui/SectionCard';
import { StatePanel } from '../components/ui/StatePanel';

import type { AnnouncementCategory } from '../types';

/** Published time in the reader's locale, with the date and minute — a notice is time-sensitive. */
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const CATEGORIES: { value: AnnouncementCategory | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'RESULTS', label: 'Results' },
  { value: 'DIVIDEND', label: 'Dividend' },
  { value: 'BOARD_MEETING', label: 'Board meeting' },
  { value: 'MATERIAL_DISCLOSURE', label: 'Material disclosure' },
  { value: 'CORPORATE_ACTION', label: 'Corporate action' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * Official notices. The filters live in the query string, so a filtered view is a link someone can
 * send — the same rule the screener follows.
 */
export function Announcements() {
  const [params, setParams] = useSearchParams();
  const category = (params.get('category') ?? '') as AnnouncementCategory | '';
  const symbol = params.get('symbol') ?? '';

  const query = useMemo(
    () => ({ category: category || undefined, symbol: symbol || undefined, limit: 100 }),
    [category, symbol],
  );
  const { data, isLoading, isError, error } = useAnnouncements(query);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Announcements
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Notices published by the exchange and by companies, as published. Every row links to the
        original document; nothing here is editorial.
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
        {CATEGORIES.map((c) => (
          <Chip
            key={c.value || 'all'}
            label={c.label}
            size="small"
            color={category === c.value ? 'primary' : 'default'}
            variant={category === c.value ? 'filled' : 'outlined'}
            onClick={() => set('category', c.value)}
          />
        ))}
        <TextField
          size="small"
          label="Symbol"
          value={symbol}
          onChange={(e) => set('symbol', e.target.value.toUpperCase())}
          sx={{ width: 140 }}
          inputProps={{ maxLength: 12 }}
        />
      </Stack>

      {isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load announcements: {(error as Error).message}. The rest of the site is
          unaffected.
        </Alert>
      ) : null}

      <SectionCard
        title={symbol ? `Notices for ${symbol}` : 'Latest notices'}
        subtitle={data ? `${data.total} on record` : undefined}
        flush
      >
        {isLoading ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">Loading…</Typography>
          </Box>
        ) : !data || data.items.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <StatePanel
              kind="empty"
              compact
              title="No announcements on record"
              description={
                symbol
                  ? `No official notice has been ingested for ${symbol}${category ? ' in this category' : ''}. An empty list means none was published or captured — not that the company was silent.`
                  : 'No official notice has been ingested yet. The exchange feed has not been wired up, so this page is empty by design rather than by quiet.'
              }
            />
          </Box>
        ) : (
          <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
            {data.items.map((a) => (
              <Box key={a.id} sx={{ px: 2, py: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={CATEGORIES.find((c) => c.value === a.category)?.label ?? a.category} />
                  {a.symbol ? (
                    <Link component={RouterLink} to={`/stocks/${a.symbol}`} underline="hover" variant="caption">
                      {a.symbol}
                    </Link>
                  ) : (
                    <Typography variant="caption" color="text.secondary">Market-wide</Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {fmtDateTime(a.publishedAt)}
                  </Typography>
                </Stack>
                <Link href={a.sourceUrl} target="_blank" rel="noopener noreferrer" underline="hover" variant="body2" sx={{ fontWeight: 600 }}>
                  {a.title}
                </Link>
                {a.summary ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {a.summary}
                  </Typography>
                ) : null}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  Source: {a.source} · original document opens in a new tab
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </SectionCard>
    </Container>
  );
}
