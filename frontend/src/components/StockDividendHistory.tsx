import { useMemo } from 'react';
import { Stack, Typography } from '@mui/material';
import { useDividendLedger } from '../api/hooks';
import { SectionCard } from './ui/SectionCard';
import { formatNumber, DASH } from '../lib/format';

/**
 * Per-share dividends for one company, totalled by the fiscal year the declaration belongs to.
 *
 * Grouped by the *announcement* year because that is the only date the source reliably carries; the
 * caption says so rather than implying a payment-year total we cannot compute.
 */
export function StockDividendHistory({ symbol }: { symbol: string }) {
  const { data } = useDividendLedger({ symbol, limit: 100 });

  const byYear = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data?.items ?? []) {
      if (!r.announcementDate || r.amount == null) continue;
      const year = r.announcementDate.slice(0, 4);
      map.set(year, (map.get(year) ?? 0) + r.amount);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  if (!data || byYear.length === 0) return null;

  return (
    <SectionCard title="Dividend history" subtitle={`Declared per share, by announcement year — ${symbol}`} flush>
      <Stack divider={<Typography sx={{ borderTop: 1, borderColor: 'divider', m: 0 }} />} sx={{ px: 2, py: 1 }}>
        {byYear.map(([year, total]) => (
          <Stack key={year} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
            <Typography variant="body2">{year}</Typography>
            <Typography variant="body2" fontWeight={600}>
              {total > 0 ? `Rs ${formatNumber(total)}` : DASH}
            </Typography>
          </Stack>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
        Totals are the sum of declared per-share dividends announced in each calendar year. A past
        dividend is a record, not a forecast; the source publishes no ex-dates, so none are shown.
      </Typography>
    </SectionCard>
  );
}
