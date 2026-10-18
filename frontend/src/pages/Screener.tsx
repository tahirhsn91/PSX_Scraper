import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Switch,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import { useScreenerPresets, useSectors, useStocks } from '../api/hooks';
import { screenUrl, useSavedScreens } from '../lib/savedScreens';
import { PageHeader } from '../components/ui/PageHeader';
import { ShariahToggle } from '../components/ShariahToggle';
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
  { key: 'minRsi', label: 'Min RSI (14)' },
  { key: 'maxRsi', label: 'Max RSI (14)' },
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

/**
 * Close versus a moving average. The server judges this on its own indicator board — the same
 * series the stock page draws — so the filter and the Technical section cannot disagree.
 */
const MA_RELATIONS: { key: NonNullable<StockFilters['maRelation']>; label: string }[] = [
  { key: 'above_sma50', label: 'Above SMA 50' },
  { key: 'below_sma50', label: 'Below SMA 50' },
  { key: 'above_sma200', label: 'Above SMA 200' },
  { key: 'below_sma200', label: 'Below SMA 200' },
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
  maRelation: StockFilters['maRelation'] | '',
): StockFilters {
  const f: StockFilters = {};
  for (const field of FIELDS) {
    const n = toNumber(criteria[field.key as string]);
    if (n != null) (f as Record<string, unknown>)[field.key as string] = n;
  }
  if (sector) f.sector = sector;
  // The period travels with the return bounds: without it "min return 20%" would have no window.
  if (period) f.returnPeriod = period;
  if (maRelation) f.maRelation = maRelation;
  return f;
}

/**
 * The stock screener. Filters are sent to the server (the list is paginated and the ratio columns
 * come from a join), so sorting and filtering both happen server-side — never in the browser.
 */
/**
 * The screen *is* the query string.
 *
 * Every filter, the preset, the sort and the page live in the URL, which buys three things at once:
 * Back returns to the previous question, a link reproduces the screen for someone else, and a saved
 * screen is just the query string stored under a name — no parallel model to keep in step.
 */
function parseScreen(params: URLSearchParams): {
  filters: StockFilters;
  criteria: Record<string, string>;
  sector: string;
  period: NonNullable<StockFilters['returnPeriod']> | '';
  maRelation: NonNullable<StockFilters['maRelation']> | '';
  sort: SortState | null;
  page: number;
  presetKey: string;
} {
  const criteria: Record<string, string> = {};
  const filters: StockFilters = {};
  for (const field of FIELDS) {
    const raw = params.get(field.key as string);
    const n = toNumber(raw ?? undefined);
    if (n != null) {
      criteria[field.key as string] = String(n);
      (filters as Record<string, unknown>)[field.key as string] = n;
    }
  }
  const sector = params.get('sector') ?? '';
  if (sector) filters.sector = sector;
  if (params.get('shariah') === '1') filters.shariah = true;
  const periodRaw = params.get('returnPeriod');
  const period = (periodRaw === '1w' || periodRaw === '1m' || periodRaw === '3m' || periodRaw === '6m' || periodRaw === '1y'
    ? periodRaw
    : '') as NonNullable<StockFilters['returnPeriod']> | '';
  if (period) filters.returnPeriod = period;
  const maRaw = params.get('maRelation');
  const maRelation = (MA_RELATIONS.some((m) => m.key === maRaw) ? maRaw : '') as
    | NonNullable<StockFilters['maRelation']>
    | '';
  if (maRelation) filters.maRelation = maRelation;
  const sortKey = params.get('sort');
  const sort = sortKey ? ({ key: sortKey, direction: params.get('order') === 'desc' ? 'desc' : 'asc' } as SortState) : null;
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  return { filters, criteria, sector, period, maRelation, sort, page, presetKey: params.get('preset') ?? '' };
}

/** Serialise a screen back to the query string, dropping anything at its default. */
function screenParams(
  filters: StockFilters,
  presetKey: string,
  sort: SortState | null,
  page: number,
): URLSearchParams {
  const next = new URLSearchParams();
  for (const field of FIELDS) {
    const v = filters[field.key];
    if (v != null) next.set(field.key as string, String(v));
  }
  if (filters.sector) next.set('sector', filters.sector);
  if (filters.shariah) next.set('shariah', '1');
  if (filters.returnPeriod) next.set('returnPeriod', filters.returnPeriod);
  if (filters.maRelation) next.set('maRelation', filters.maRelation);
  if (presetKey) next.set('preset', presetKey);
  if (sort?.key) {
    next.set('sort', String(sort.key));
    next.set('order', sort.direction ?? 'asc');
  }
  if (page > 1) next.set('page', String(page));
  return next;
}

export function Screener() {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseScreen(params), [params]);
  const { filters: applied, sort, page, presetKey } = view;

  // The form is a draft of the screen: it only reaches the URL when Apply is pressed.
  const [criteria, setCriteria] = useState<Record<string, string>>(view.criteria);
  const [sector, setSector] = useState(view.sector);
  const [period, setPeriod] = useState(view.period);
  const [maRelation, setMaRelation] = useState(view.maRelation);
  const [showTech, setShowTech] = useState(false);

  // Follow Back / Forward: the form should show what the results show.
  useEffect(() => {
    setCriteria(view.criteria);
    setSector(view.sector);
    setPeriod(view.period);
    setMaRelation(view.maRelation);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the query string on purpose
  }, [params.toString()]);

  const { data: sectors } = useSectors();
  const { data: presetList } = useScreenerPresets();
  const { screens, save, remove, blocked } = useSavedScreens();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const currentQuery = params.toString();
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
    hasFilters || showTech ? { ...applied, ...(showTech ? { technical: true } : {}) } : undefined,
    presetKey || undefined,
  );
  const activePreset = data?.preset;
  const activePeriodMeta = PERIODS.find((x) => x.key === applied.returnPeriod);

  const setField = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCriteria((c) => ({ ...c, [key]: e.target.value }));

  const apply = () => {
    setParams(screenParams(buildFilters(criteria, sector, period || undefined, maRelation), presetKey, null, 1));
  };
  const reset = () => {
    setParams(new URLSearchParams());
    setCriteria({});
    setSector('');
    setPeriod('');
    setMaRelation('');
  };

  /** Choose a named screen: its criteria, ordering and reason all come from the server. */
  const choosePreset = (key: string) => {
    setParams(screenParams({}, key, null, 1));
    setCriteria({});
    setSector('');
    setPeriod('');
  };

  const openSave = () => {
    setSaveName('');
    setSaveError(null);
    setSaveOpen(true);
  };
  const commitSave = () => {
    const res = save(saveName, currentQuery);
    if (!res.ok) {
      setSaveError(res.error ?? 'Could not save this screen.');
      return;
    }
    setSaveOpen(false);
  };
  /** Applying a saved screen is a navigation to the query it holds — nothing to re-derive. */
  const applySaved = (query: string) => {
    setParams(new URLSearchParams(query));
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(screenUrl(currentQuery));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context or permission): the URL is in the address bar anyway.
      setCopied(false);
    }
  };

  /** Sorting is a change to the question, so it goes in the URL and returns to page one. */
  const changeSort = (next: SortState | null) => {
    setParams(screenParams(applied, presetKey, next, 1));
  };
  const changePage = (p: number) => {
    setParams(screenParams(applied, presetKey, sort, p));
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
    ...(showTech
      ? [
          {
            key: 'rsi',
            header: 'RSI (14)',
            align: 'right' as const,
            render: (r: StockListItem) =>
              r.rsi != null ? formatNumber(r.rsi, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : DASH,
            hideBelow: 'md' as const,
          },
          {
            key: 'ma',
            header: 'vs SMA',
            align: 'right' as const,
            render: (r: StockListItem) =>
              r.maRelation === 'above_sma50' ? 'Above 50' : r.maRelation === 'below_sma50' ? 'Below 50' : DASH,
            hideBelow: 'md' as const,
          },
        ]
      : []),
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
      <ShariahToggle
        on={!!applied.shariah}
        onToggle={() => {
          const next = new URLSearchParams(params);
          if (applied.shariah) next.delete('shariah');
          else next.set('shariah', '1');
          setParams(next, { replace: true });
        }}
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
      <SectionCard
        title="Saved screens"
        subtitle="Kept in this browser only — no account, nothing sent to a server"
        action={
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={copyLink}>
              {copied ? 'Link copied' : 'Copy link'}
            </Button>
            <Button size="small" variant="contained" onClick={openSave} disabled={blocked}>
              Save this screen
            </Button>
          </Stack>
        }
        sx={{ mb: 3 }}
      >
        {blocked ? (
          <Alert severity="info" sx={{ mb: screens.length ? 2 : 0 }}>
            This browser is blocking local storage (private mode, or a policy), so screens cannot be
            saved on this device. The Copy link button still produces a working shareable URL.
          </Alert>
        ) : null}
        {screens.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No saved screens yet. Set the filters you want, then use Save this screen.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {screens.map((sc) => (
              <Stack
                key={sc.id}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Button
                    size="small"
                    sx={{ textTransform: 'none', px: 0 }}
                    onClick={() => applySaved(sc.query)}
                  >
                    {sc.name}
                  </Button>
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>
                    {sc.query || 'No filters — the whole universe'}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    if (window.confirm(`Delete the saved screen "${sc.name}"?`)) remove(sc.id);
                  }}
                >
                  Delete
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>
      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Save this screen</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            The filters, preset, period and sort currently applied are stored with the name. Nothing
            leaves this device.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={saveName}
            onChange={(e) => {
              setSaveName(e.target.value);
              setSaveError(null);
            }}
            error={Boolean(saveError)}
            helperText={saveError ?? undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSave();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={commitSave}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
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
          <Grid item xs={6} sm={4} md={3}>
            <TextField
              fullWidth
              size="small"
              select
              label="Moving average"
              value={maRelation}
              onChange={(e) => setMaRelation(e.target.value as typeof maRelation)}
            >
              <MenuItem value="">Any</MenuItem>
              {MA_RELATIONS.map((m) => (
                <MenuItem key={m.key} value={m.key}>
                  {m.label}
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
        <Box sx={{ mt: 1 }}>
          <FormControlLabel
            control={<Switch size="small" checked={showTech} onChange={(e) => setShowTech(e.target.checked)} />}
            label={
              <Typography variant="body2">
                Show RSI and moving-average columns
              </Typography>
            }
          />
        </Box>
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
        {data?.technical && (applied.minRsi != null || applied.maxRsi != null || applied.maRelation) ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1.5 }}>
            {data.technical.excluded} stocks are left out of technical filters: they have fewer than{' '}
            {data.technical.minimumSessions} sessions of history in the last 500 days, so RSI and the
            averages cannot be computed. They are excluded rather than treated as zero.
          </Typography>
        ) : null}
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
          onSortChange={changeSort}
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
              onPageChange={(_, p) => changePage(p + 1)}
              rowsPerPage={PAGE_SIZE}
              rowsPerPageOptions={[PAGE_SIZE]}
            />
          }
        />
      </SectionCard>
    </>
  );
}
