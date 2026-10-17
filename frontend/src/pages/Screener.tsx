import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Grid, MenuItem, Stack, TablePagination, TextField, Typography } from '@mui/material';
import { useScreenerPresets, useSectors, useStocks } from '../api/hooks';
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
  { key: 'minReturn', label: 'Min return', percent: true },
  { key: 'maxReturn', label: 'Max return', percent: true },
];

/** The periods the return column and filter can use, with the sessions each one means. */
const PERIODS: { key: NonNullable<StockFilters['returnPeriod']>; label: string; sessions: number }[] = [
  { key: '1w', label: '1W', sessions: 6 },
  { key: '1m', label: '1M', sessions: 22 },
  { key: '3m', label: '3M', sessions: 64 },
  { key: '6m', label: '6M', sessions: 127 },
  { key: '1y', label: '1Y', sessions: 253 },
];

const PAGE_SIZE = 50;

function toNumber(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Build the filter object from the raw form strings, dropping every empty field. */
function buildFilters(
  criteria: Record<string, string>,
  sector: string,
  period: StockFilters['returnPeriod'],
): StockFilters {
  const f: StockFilters = {};
  for (const field of FIELDS) {
    const n = toNumber(criteria[field.key as string]);
    if (n != null) (f as Record<string, unknown>)[field.key as string] = n;
  }
  if (sector) f.sector = sector;
  // The period travels with the return bounds: without it "min return 20%" would have no window.
  if (period) f.returnPeriod = period;
  return f;
}

/**
 * The stock screener. Filters are sent to the server (the list is paginated and the ratio columns
 * come from a join), so sorting and filtering both happen server-side — never in the browser.
 */
export function Screener() {
  const [params, setParams] = useSearchParams();
  const sectorParam = params.get('sector') ?? '';
  // The preset lives in the URL, so a screen is linkable: "the low-P/E list" is a place, not a
  // transient piece of component state that dies on refresh.
  const presetKey = params.get('preset') ?? '';

  const [criteria, setCriteria] = useState<Record<string, string>>({});
  const [sector, setSector] = useState(sectorParam);
  const [period, setPeriod] = useState<NonNullable<StockFilters['returnPeriod']> | ''>('');
  const [applied, setApplied] = useState<StockFilters>(sectorParam ? { sector: sectorParam } : {});
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);

  const { data: sectors } = useSectors();
  const { data: presetList } = useScreenerPresets();
  const hasFilters = Object.keys(applied).length > 0;

  const { data, isLoading, error, refetch } = useStocks(
    page,
    PAGE_SIZE,
    false,
    // A preset carries its own ordering; sending a sort would override what the screen means.
    presetKey ? undefined : (sort?.key as StockSortField) ?? undefined,
    (sort?.direction as SortOrder) ?? 'asc',
    undefined,
    undefined,
    hasFilters ? applied : undefined,
    presetKey || undefined,
  );
  const activePreset = data?.preset;
  const activePeriod = applied.returnPeriod;
  const activePeriodMeta = PERIODS.find((x) => x.key === activePeriod);

  const setField = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCriteria((c) => ({ ...c, [key]: e.target.value }));

  const apply = () => {
    setApplied(buildFilters(criteria, sector, period || undefined));
    setPage(1);
  };
  const reset = () => {
    setCriteria({});
    setSector('');
    setPeriod('');
    setApplied({});
    setPage(1);
    setSort(null);
    if (presetKey) {
      const next = new URLSearchParams(params);
      next.delete('preset');
      setParams(next, { replace: true });
    }
  };

  /** Choose a named screen: its criteria, ordering and reason all come from the server. */
  const choosePreset = (key: string) => {
    const next = new URLSearchParams(params);
    if (key) next.set('preset', key);
    else next.delete('preset');
    setParams(next, { replace: true });
    setPage(1);
    setSort(null);
    setApplied({});
    setCriteria({});
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
    ...(activePeriodMeta
      ? [
          {
            key: 'periodReturn',
            header: `${activePeriodMeta.label} return`,
            align: 'right' as const,
            // Null is not zero: the stock does not have the sessions the period needs, and the cell
            // says so rather than printing a dash that could be read as a flat month.
            render: (r: StockListItem) =>
              r.periodReturn != null ? (
                `${r.periodReturn > 0 ? '+' : ''}${formatNumber(r.periodReturn)}%`
              ) : r.returnSessions != null && r.returnSessions < activePeriodMeta.sessions ? (
                <span title={`Only ${r.returnSessions} sessions of history; ${activePeriodMeta.label} needs ${activePeriodMeta.sessions}`}>
                  n/a
                </span>
              ) : (
                DASH
              ),
            sortKey: 'return' as StockSortField,
            hideBelow: 'sm' as const,
          },
        ]
      : []),
    {
      key: 'roe',
      header: 'ROE',
      align: 'right',
      render: (r) => (r.roe != null ? `${formatNumber(r.roe)}%` : DASH),
      sortKey: 'roe',
      hideBelow: 'md',
    },
    ...(presetKey || activePeriodMeta
      ? []
      : [
          {
            key: 'beta',
            header: 'Beta',
            align: 'right' as const,
            render: (r: StockListItem) => formatNumber(r.beta),
            sortKey: 'beta' as StockSortField,
            hideBelow: 'md' as const,
          },
        ]),
    ...(presetKey
      ? [
          {
            key: 'reason',
            header: 'Why it is here',
            render: (r: StockListItem) => r.reason ?? DASH,
            hideBelow: 'md' as const,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Stock screener"
        subtitle="Filter the whole universe by price, size, fundamentals and period return, then sort any column"
      />
      <SectionCard title="Named screens" sx={{ mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Each screen is defined on the server, so the name means the same thing here as it does in a
          saved link. Choosing one replaces the filters below.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {(presetList?.items ?? []).map((p) => (
            <Button
              key={p.key}
              size="small"
              variant={p.key === presetKey ? 'contained' : 'outlined'}
              onClick={() => choosePreset(p.key === presetKey ? '' : p.key)}
            >
              {p.label}
            </Button>
          ))}
        </Stack>
        {activePreset ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2">{activePreset.description}</Typography>
            {activePreset.caveat ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {activePreset.caveat}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </SectionCard>
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
          <Grid item xs={12} sm={6} md={4}>
            <TextField
              select
              fullWidth
              size="small"
              label="Return period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
            >
              <MenuItem value="">None</MenuItem>
              {PERIODS.map((x) => (
                <MenuItem key={x.key} value={x.key}>
                  {x.label} ({x.sessions - 1} sessions)
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
          data
            ? `${data.total} matching stock${data.total === 1 ? '' : 's'}${
                activePreset ? ` · ${activePreset.label}` : ''
              }`
            : 'Apply filters or pick a screen'
        }
        action={
          hasFilters || presetKey ? (
            <Button size="small" onClick={reset}>
              Clear
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
          // The same 160ms body entrance the dashboard uses: applying a filter, turning a page or
          // re-sorting is a new question, and the rows should arrive as one rather than swap.
          transitionKey={`${presetKey}-${JSON.stringify(applied)}-${page}-${sort?.key ?? 'default'}-${sort?.direction ?? ''}`}
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
