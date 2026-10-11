import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Grid, MenuItem, TablePagination, TextField } from '@mui/material';
import { useSectors, useStocks } from '../api/hooks';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { DataTable, type Column, type SortState } from '../components/ui/DataTable';
import { ChangePill } from '../components/ui/ChangePill';
import { formatMarketCap, formatNumber, DASH } from '../lib/format';
import type { StockFilters, StockListItem, StockSortField, SortOrder } from '../types';

/** Number fields the form offers, keyed by the API's filter name. `%` marks a percentage field. */
const FIELDS: { key: keyof StockFilters; label: string; percent?: boolean }[] = [
  { key: 'minPrice', label: 'Min price (Rs)' },
  { key: 'maxPrice', label: 'Max price (Rs)' },
  { key: 'minMarketCap', label: 'Min market cap (Rs)' },
  { key: 'maxMarketCap', label: 'Max market cap (Rs)' },
  { key: 'minDividendYield', label: 'Min dividend yield', percent: true },
  { key: 'minPe', label: 'Min P/E' },
  { key: 'maxPe', label: 'Max P/E' },
  { key: 'minPb', label: 'Min P/B' },
  { key: 'maxPb', label: 'Max P/B' },
  { key: 'minRoe', label: 'Min ROE', percent: true },
  { key: 'maxDebtToEquity', label: 'Max debt/equity' },
];

const PAGE_SIZE = 50;

function toNumber(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Build the filter object from the raw form strings, dropping every empty field. */
function buildFilters(criteria: Record<string, string>, sector: string): StockFilters {
  const f: StockFilters = {};
  for (const field of FIELDS) {
    const n = toNumber(criteria[field.key as string]);
    if (n != null) (f as Record<string, unknown>)[field.key as string] = n;
  }
  if (sector) f.sector = sector;
  return f;
}

/**
 * The stock screener. Filters are sent to the server (the list is paginated and the ratio columns
 * come from a join), so sorting and filtering both happen server-side — never in the browser.
 */
export function Screener() {
  const [params] = useSearchParams();
  const sectorParam = params.get('sector') ?? '';

  const [criteria, setCriteria] = useState<Record<string, string>>({});
  const [sector, setSector] = useState(sectorParam);
  const [applied, setApplied] = useState<StockFilters>(sectorParam ? { sector: sectorParam } : {});
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);

  const { data: sectors } = useSectors();
  const hasFilters = Object.keys(applied).length > 0;

  const { data, isLoading, error, refetch } = useStocks(
    page,
    PAGE_SIZE,
    false,
    (sort?.key as StockSortField) ?? undefined,
    (sort?.direction as SortOrder) ?? 'asc',
    undefined,
    undefined,
    hasFilters ? applied : undefined,
  );

  const setField = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCriteria((c) => ({ ...c, [key]: e.target.value }));

  const apply = () => {
    setApplied(buildFilters(criteria, sector));
    setPage(1);
  };
  const reset = () => {
    setCriteria({});
    setSector('');
    setApplied({});
    setPage(1);
    setSort(null);
  };

  const columns: Column<StockListItem>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      render: (r) => r.symbol,
      sortKey: 'symbol',
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
      key: 'sector',
      header: 'Sector',
      render: (r) => r.sector ?? DASH,
      noWrap: true,
      hideBelow: 'md',
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (r) => formatNumber(r.currentPrice),
      sortKey: 'price',
      mobileRole: 'value',
    },
    {
      key: 'changePercent',
      header: 'Change',
      align: 'right',
      render: (r) => <ChangePill value={r.changePercent} />,
      sortKey: 'changePercent',
      mobileRole: 'meta',
    },
    {
      key: 'marketCap',
      header: 'Market cap',
      align: 'right',
      render: (r) => formatMarketCap(r.marketCap) ?? DASH,
      sortKey: 'marketCap',
      hideBelow: 'sm',
    },
    {
      key: 'peRatio',
      header: 'P/E',
      align: 'right',
      render: (r) => formatNumber(r.peRatio),
      sortKey: 'peRatio',
      hideBelow: 'sm',
    },
    {
      key: 'pbRatio',
      header: 'P/B',
      align: 'right',
      render: (r) => formatNumber(r.pbRatio),
      sortKey: 'pbRatio',
      hideBelow: 'md',
    },
    {
      key: 'dividendYield',
      header: 'Yield',
      align: 'right',
      render: (r) => (r.dividendYield != null ? `${formatNumber(r.dividendYield)}%` : DASH),
      sortKey: 'dividendYield',
      hideBelow: 'sm',
    },
    {
      key: 'roe',
      header: 'ROE',
      align: 'right',
      render: (r) => (r.roe != null ? `${formatNumber(r.roe)}%` : DASH),
      sortKey: 'roe',
      hideBelow: 'md',
    },
    {
      key: 'beta',
      header: 'Beta',
      align: 'right',
      render: (r) => formatNumber(r.beta),
      sortKey: 'beta',
      hideBelow: 'md',
    },
  ];

  return (
    <>
      <PageHeader
        title="Stock screener"
        subtitle="Filter the whole universe by price, size and fundamentals, then sort any column"
      />
      <SectionCard title="Filters" sx={{ mb: 3 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4}>
            <TextField
              select
              fullWidth
              size="small"
              label="Sector"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
            >
              <MenuItem value="">All sectors</MenuItem>
              {(sectors?.items ?? []).map((s) => (
                <MenuItem key={s.sector} value={s.sector}>
                  {s.sector}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          {FIELDS.map((f) => (
            <Grid item xs={6} sm={4} md={3} key={f.key as string}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label={f.label}
                value={criteria[f.key as string] ?? ''}
                onChange={setField(f.key as string)}
                inputProps={{ inputMode: 'decimal' }}
              />
            </Grid>
          ))}
        </Grid>
        <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
          <Button variant="contained" onClick={apply}>
            Apply
          </Button>
          <Button variant="outlined" onClick={reset}>
            Reset
          </Button>
        </Box>
      </SectionCard>
      <SectionCard
        title="Results"
        subtitle={
          data ? `${data.total} matching stock${data.total === 1 ? '' : 's'}` : 'Apply filters to narrow the universe'
        }
        action={
          hasFilters ? (
            <Button size="small" onClick={reset}>
              Clear filters
            </Button>
          ) : undefined
        }
        flush
      >
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.symbol}
          rowHref={(r) => `/stocks/${r.symbol}`}
          ariaLabel="Screener results"
          loading={isLoading}
          error={error ? 'Could not run the screener.' : undefined}
          onRetry={refetch}
          sort={sort}
          onSortChange={setSort}
          emptyTitle="No matches"
          emptyDescription="Loosen the criteria — the current filters match no tracked stock."
          pagination={
            <TablePagination
              component="div"
              count={data?.total ?? 0}
              page={(data?.page ?? 1) - 1}
              onPageChange={(_, p) => setPage(p + 1)}
              rowsPerPage={PAGE_SIZE}
              rowsPerPageOptions={[PAGE_SIZE]}
            />
          }
        />
      </SectionCard>
    </>
  );
}
