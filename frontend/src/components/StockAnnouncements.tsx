import { Chip, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useAnnouncements } from '../api/hooks';
import { SectionCard } from './ui/SectionCard';

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });

/**
 * The notice feed for one symbol.
 *
 * Deliberately quiet: if the feed fails, this renders nothing at all. A notice list is useful, but
 * the price, the chart and the statements are the page — an announcements outage must not put an
 * error box in the middle of them.
 */
export function StockAnnouncements({ symbol }: { symbol: string }) {
  const { data, isError } = useAnnouncements({ symbol, limit: 5 });
  if (isError) return null;
  if (!data) return null;

  return (
    <SectionCard
      title="Announcements"
      subtitle={data.total > 0 ? `Latest ${Math.min(data.total, 5)} of ${data.total}` : undefined}
      flush
    >
      {data.items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
          No official notice on record for {symbol}. None has been published or captured — not a
          claim that the company has been silent.
        </Typography>
      ) : (
        <Stack divider={<Typography sx={{ borderTop: 1, borderColor: 'divider', m: 0 }} />}>
          {data.items.map((a) => (
            <Stack key={a.id} sx={{ px: 2, py: 1.25 }} spacing={0.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" label={a.category.replace(/_/g, ' ').toLowerCase()} />
                <Typography variant="caption" color="text.secondary">
                  {fmt(a.publishedAt)} · {a.source}
                </Typography>
              </Stack>
              <Link href={a.sourceUrl} target="_blank" rel="noopener noreferrer" variant="body2" underline="hover">
                {a.title}
              </Link>
            </Stack>
          ))}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
        <Link component={RouterLink} to={`/announcements?symbol=${symbol}`} underline="hover">
          All notices for {symbol}
        </Link>
      </Typography>
    </SectionCard>
  );
}
