import { useSearchParams } from 'react-router-dom';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Chip, Stack, TextField, Typography } from '@mui/material';
import { useDividendLedger, useDividends } from '../api/hooks';
import { PageHeader } from '../components/ui/PageHeader';
import { DataStatus } from '../components/ui/DataStatus';
import { SectionCard } from '../components/ui/SectionCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { formatNumber, formatDate, DASH } from '../lib/format';
import type { DividendLedgerRow, YieldRow } from '../types';

const STATUS_COLORS: Record<DividendLedgerRow['status'], 'success' | 'default' | 'warning'> = {
  paid: 'success',
  declared: 'warning',
  unknown: 'default',
};

const ledgerColumns: Column<DividendLedgerRow>[] = [
  {
    key: 'symbol',
    header: 'Symbol',
    render: (r) => r.symbol,
    mobileRole: 'title',
  },
  {
    key: 'company',
    header: 'Company',
    render: (r) => r.companyName ?? DASH,
    noWrap: true,
    hideBelow: 'md',
  },
  {
    key: 'amount',
    header: 'Per share',
    align: 'right',
    render: (r) => (r.amount != null ? `Rs ${formatNumber(r.amount)}` : DASH),
    mobileRole: 'value',
  },
  {
    key: 'announced',
    header: 'Announced',
    align: 'right',
    render: (r) => formatDate(r.announcementDate),
    mobileRole: 'meta',
  },
  {
    key: 'exDate',
    header: 'Ex-date',
    align: 'right',
    // Never inferred from the book-closure date: an invented ex-date would later drive a price
    // adjustment that never happened.
    render: (r) => formatDate(r.exDate),
    hideBelow: 'sm',
  },
  {
    key: 'bookClosure',
    header: 'Book closure',
    align: 'right',
    render: (r) => formatDate(r.bookClosure),
    hideBelow: 'md',
  },
  {
    key: 'payment',
    header: 'Payment',
    align: 'right',
    render: (r) => formatDate(r.paymentDate),
    hideBelow: 'md',
  },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    render: (r) => (
      <Chip size="small" label={r.status} color={STATUS_COLORS[r.status]} variant="outlined" />
    ),
    hideBelow: 'sm',
  },
  {
    key: 'yield',
    header: 'Yield (12m)',
    align: 'right',
    render: (r) => (r.yieldTtm != null ? `${formatNumber(r.yieldTtm)}%` : DASH),
    hideBelow: 'sm',
  },
];

const yieldColumns: Column<YieldRow>[] = [
  { key: 'symbol', header: 'Symbol', render: (r) => r.symbol, mobileRole: 'title' },
  {
    key: 'company',
    header: 'Company',
    render: (r) => r.companyName ?? DASH,
    noWrap: true,
    hideBelow: 'md',
  },
  { key: 'sector', header: 'Sector', render: (r) => r.sector ?? DASH, noWrap: true, hideBelow: 'md' },
  {
    key: 'yield',
    header: 'Yield',
    align: 'right',
    render: (r) => (r.dividendYield != null ? `${formatNumber(r.dividendYield)}%` : DASH),
    mobileRole: 'value',
  },
  {
    key: 'price',
    header: 'Price',
    align: 'right',
    render: (r) => formatNumber(r.currentPrice),
    mobileRole: 'meta',
  },
];

/**
 * Dividends, as declared.
 *
 * Two things this page refuses to do: invent a date the source does not publish, and call a dividend
 * "paid" without evidence. The ex-date column is empty because the provider carries none — it fills
 * when the notice feed lands — and a dividend with no payment date is `unknown`, not `declared`.
 */
export function Dividends() {
  const [params, setParams] = useSearchParams();
  const symbol = params.get('symbol') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const minYieldRaw = params.get('minYield') ?? '';
  const minYield = minYieldRaw ? Number(minYieldRaw) : undefined;

  const ledger = useDividendLedger({
    symbol: symbol || undefined,
    from: from || undefined,
    to: to || undefined,
    minYield: Number.isFinite(minYield) ? minYield : undefined,
  });
  const { data: summary, error: summaryError, refetch } = useDividends();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = ledger.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Dividends"
        subtitle="Every declared dividend, with the dates the source actually carries"
        meta={<DataStatus dataset="dividends" />}
      />

      <SectionCard
        title="Dividend ledger"
        subtitle={
          ledger.data
            ? `${ledger.data.total} declaration${ledger.data.total === 1 ? '' : 's'}${symbol ? ` for ${symbol}` : ''}`
            : 'Loading…'
        }
        flush
        sx={{ mb: 3 }}
      >
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          flexWrap="wrap"
          sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
        >
          <TextField
            size="small"
            label="Symbol"
            value={symbol}
            onChange={(e) => set('symbol', e.target.value.toUpperCase())}
            sx={{ width: 130 }}
            inputProps={{ maxLength: 12 }}
          />
          <TextField
            size="small"
            label="Announced from"
            type="date"
            value={from}
            onChange={(e) => set('from', e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ width: 170 }}
          />
          <TextField
            size="small"
            label="Announced to"
            type="date"
            value={to}
            onChange={(e) => set('to', e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ width: 170 }}
          />
          <TextField
            size="small"
            label="Min yield %"
            type="number"
            value={minYieldRaw}
            onChange={(e) => set('minYield', e.target.value)}
            sx={{ width: 130 }}
            inputProps={{ min: 0, max: 100, step: 0.5 }}
          />
        </Stack>

        <DataTable
          columns={ledgerColumns}
          rows={rows}
          rowKey={(r) => `${r.symbol}-${r.announcementDate ?? 'x'}-${r.amount ?? 'x'}`}
          rowHref={(r) => `/stocks/${r.symbol}`}
          ariaLabel="Dividend ledger"
          loading={ledger.isLoading}
          error={ledger.error ? 'Could not load the dividend ledger.' : undefined}
          onRetry={() => ledger.refetch()}
          emptyTitle="No dividends on record"
          emptyDescription="No declaration matches these filters. The source carries 1,002 declarations in total, so widen the dates or clear the symbol."
        />
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Yield (12m) is every dividend <em>declared</em> in the last 365 days divided by the latest
            price — a trailing measure, not a forecast. Ex-date is blank because the source publishes
            none; it fills from the corporate-action feed when that is wired. Payment status is{' '}
            <em>unknown</em> whenever no payment date was published.
          </Typography>
        </Box>
      </SectionCard>

      <SectionCard title="Highest yields" subtitle="Ranked by the provider's published yield, highest first" flush>
        <DataTable
          columns={yieldColumns}
          rows={summary?.topYield ?? []}
          rowKey={(r) => r.symbol}
          rowHref={(r) => `/stocks/${r.symbol}`}
          ariaLabel="Highest dividend yields"
          error={summaryError ? 'Could not load yields.' : undefined}
          onRetry={refetch}
          emptyTitle="No yields yet"
          emptyDescription="Yield rankings appear once dividend and price data are both present."
        />
      </SectionCard>

      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
        Looking for one company? <RouterLink to="/screener">Screener</RouterLink> filters by sector
        and price; dividend history for a single stock sits on its page.
      </Typography>
    </>
  );
}
