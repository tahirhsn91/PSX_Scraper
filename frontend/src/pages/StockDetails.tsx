import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Grid,
  LinearProgress,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import DownloadIcon from '@mui/icons-material/Download';
import { LineChart } from '@mui/x-charts/LineChart';
import { useQueryClient } from '@tanstack/react-query';
import { CandleChart } from '../components/CandleChart';
import { TradingViewChart } from '../components/TradingViewChart';
import { FundamentalsPanel } from '../components/FundamentalsPanel';
import { QuickJumpNav, type QuickJumpSection } from '../components/QuickJumpNav';
import { ChangePill } from '../components/ui/ChangePill';
import { DataTable, type Column } from '../components/ui/DataTable';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatTile } from '../components/ui/StatTile';
import { StatePanel } from '../components/ui/StatePanel';
import {
  DASH,
  formatCount,
  formatDate,
  formatDateTime,
  formatMarketCap,
  formatNumber,
  formatVolume,
} from '../lib/format';
import {
  keys,
  useCandles,
  useFetchHistory,
  useHistory,
  useHistoryStatus,
  useStock,
  useSyncStatus,
  useSyncStock,
} from '../api/hooks';
import type { HistoryRange, StockDetail } from '../types';

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: '3Y', label: '3Y' },
  { value: '5Y', label: '5Y' },
  { value: 'MAX', label: 'Max' },
];

/** Candles are ours; the TradingView tab is their widget; the line view is the older chart. */
type ChartMode = 'candles' | 'line' | 'tradingview';

/** The page's sections, in reading order. `id` is the anchor the sticky quick-jump scrolls to. */
const SECTIONS: QuickJumpSection[] = [
  { id: 'section-history', label: 'History' },
  { id: 'section-fundamentals', label: 'Fundamentals' },
  { id: 'section-financials', label: 'Financials' },
  { id: 'section-ratios', label: 'Ratios' },
  { id: 'section-dividends', label: 'Dividends' },
];

/** Spelled-out form of a range preset, for the caption above the chart. */
const rangeLabel = (r: HistoryRange): string =>
  ({
    '1W': 'past 1 week',
    '1M': 'past 1 month',
    '6M': 'past 6 months',
    '1Y': 'past 1 year',
    '3Y': 'past 3 years',
    '5Y': 'past 5 years',
    MAX: 'all stored sessions',
  })[r];

type Financial = StockDetail['financials'][number];
type Dividend = StockDetail['dividends'][number];

const financialColumns: Column<Financial>[] = [
  { key: 'year', header: 'Year', render: (f) => f.year, mobileRole: 'title' },
  { key: 'quarter', header: 'Qtr', render: (f) => f.quarter ?? DASH, mobileRole: 'subtitle' },
  {
    key: 'eps',
    header: 'EPS',
    align: 'right',
    mobileRole: 'meta',
    render: (f) => formatNumber(f.eps),
  },
  {
    key: 'sales',
    header: 'Sales',
    align: 'right',
    hideBelow: 'md',
    mobileRole: 'meta',
    render: (f) => formatNumber(f.sales),
  },
  {
    key: 'pat',
    header: 'PAT',
    align: 'right',
    mobileRole: 'meta',
    render: (f) => formatNumber(f.profitAfterTax),
  },
  {
    key: 'equity',
    header: 'Equity',
    align: 'right',
    hideBelow: 'md',
    mobileRole: 'meta',
    render: (f) => formatNumber(f.equity),
  },
];

const dividendColumns: Column<Dividend>[] = [
  {
    key: 'announced',
    header: 'Announced',
    render: (d) => formatDate(d.announcementDate),
    mobileRole: 'title',
  },
  {
    key: 'bookClosure',
    header: 'Book closure',
    render: (d) => formatDate(d.bookClosure),
    mobileRole: 'meta',
  },
  {
    key: 'payment',
    header: 'Payment',
    hideBelow: 'md',
    render: (d) => formatDate(d.paymentDate),
    mobileRole: 'meta',
  },
  {
    key: 'dividend',
    header: 'Dividend',
    align: 'right',
    mobileRole: 'value',
    render: (d) => formatNumber(d.dividend),
  },
];

const RATIO_TILES: { key: keyof NonNullable<StockDetail['ratios']>; label: string; suffix?: string }[] = [
  { key: 'peRatio', label: 'P/E' },
  { key: 'pbRatio', label: 'P/B' },
  { key: 'roe', label: 'ROE', suffix: '%' },
  { key: 'roa', label: 'ROA', suffix: '%' },
  { key: 'dividendYield', label: 'Dividend yield', suffix: '%' },
  { key: 'beta', label: 'Beta' },
];

export function StockDetails() {
  const { symbol = '' } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const qc = useQueryClient();
  const { data, isLoading, isError } = useStock(symbol);
  const [range, setRange] = useState<HistoryRange>('1Y');
  const { data: history, isFetching: historyLoading } = useHistory(symbol, range);
  // One range control drives both views: the API resolves the preset (1W … MAX) to a lower
  // bound, so the candle chart really does show one week when 1W is picked.
  const [chartMode, setChartMode] = useState<ChartMode>('candles');
  const { data: candles, isLoading: candlesLoading } = useCandles(symbol);
  const syncStock = useSyncStock();
  const { data: status } = useSyncStatus(syncStock.isPending);
  // Sticky header + quick-jump nav height, reported by the nav so anchors scroll below both bars.
  const [scrollOffset, setScrollOffset] = useState(0);

  // Historical fetch job + live progress
  const fetchHistory = useFetchHistory(symbol);
  const [fetching, setFetching] = useState(false);
  const { data: histJob } = useHistoryStatus(symbol, fetching);

  const progressPct = (() => {
    const p = histJob?.progress;
    if (p && typeof p === 'object' && typeof p.percent === 'number') return p.percent;
    return null;
  })();

  useEffect(() => {
    if (!fetching || !histJob) return;
    if (histJob.state === 'completed' || histJob.state === 'failed') {
      setFetching(false);
      qc.invalidateQueries({ queryKey: keys.history(symbol, range) });
      qc.invalidateQueries({ queryKey: keys.stock(symbol) });
    }
  }, [histJob, fetching, qc, symbol, range]);

  const startFetch = () => {
    setFetching(true);
    fetchHistory.mutate(range, { onError: () => setFetching(false) });
  };

  const syncing = syncStock.isPending || (status?.inFlight ?? []).includes(symbol.toUpperCase());

  if (isLoading) {
    return (
      <Box>
        <Skeleton height={44} width="40%" />
        <Skeleton height={24} width="60%" sx={{ mb: 2 }} />
        <Grid container spacing={1.5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Grid item xs={6} md={3} key={i}>
              <Skeleton variant="rounded" height={92} />
            </Grid>
          ))}
        </Grid>
        <Skeleton variant="rounded" height={340} sx={{ mt: 2 }} />
      </Box>
    );
  }

  if (isError || !data) {
    return (
      <StatePanel
        kind="error"
        title={`Could not load ${symbol}`}
        description="It may not be tracked yet, or the symbol is not on the exchange."
        action={
          <Stack direction="row" spacing={1}>
            <Button variant="contained" component={RouterLink} to="/">
              Back to the market board
            </Button>
            <Button component={RouterLink} to="/search">
              Search symbols
            </Button>
          </Stack>
        }
      />
    );
  }

  const price = data.price;
  const chart = (history?.items ?? [])
    .filter((p) => p.close != null && p.lastTradeDate)
    .slice()
    .reverse();

  // Where today's price sits inside the 52-week range — a bar says it faster than two numbers.
  const rangePct = (() => {
    if (!price || price.currentPrice == null) return null;
    const { week52Low: low, week52High: high } = price;
    if (low == null || high == null || high <= low) return null;
    return Math.min(100, Math.max(0, ((price.currentPrice - low) / (high - low)) * 100));
  })();

  return (
    <Box>
      <PageHeader
        title={data.symbol}
        subtitle={
          [data.companyName, data.sector].filter(Boolean).join(' · ') || 'No company record scraped yet'
        }
        crumbs={[{ label: 'Market board', to: '/' }, { label: data.symbol }]}
        meta={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            {data.lastSync && (
              <Chip
                size="small"
                label={`Last sync ${data.lastSync.status.toLowerCase()}`}
                color={
                  data.lastSync.status === 'SUCCESS'
                    ? 'success'
                    : data.lastSync.status === 'FAILED'
                      ? 'error'
                      : 'warning'
                }
                variant="outlined"
              />
            )}
            <Typography variant="caption" color="text.secondary">
              {price?.lastTradeDate
                ? `Last trade ${formatDate(price.lastTradeDate)}`
                : 'No price row stored yet'}
            </Typography>
          </Stack>
        }
        actions={
          <Button
            variant="contained"
            startIcon={<SyncIcon />}
            disabled={syncing}
            onClick={() => syncStock.mutate(symbol)}
          >
            {syncing ? 'Syncing…' : 'Sync latest data'}
          </Button>
        }
      />

      {syncing && <LinearProgress sx={{ mb: 2 }} />}

      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile
            label="Price"
            value={formatNumber(price?.currentPrice)}
            valueTitle={price?.currentPrice != null ? `Rs ${price.currentPrice}` : undefined}
            footer={
              <Stack direction="row" spacing={1} alignItems="center">
                <ChangePill value={price?.changePercent} variant="soft" />
                <Typography variant="caption" color="text.secondary">
                  {price?.change != null
                    ? `${price.change > 0 ? '+' : ''}${price.change}`
                    : DASH}
                </Typography>
              </Stack>
            }
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile
            label="Volume"
            value={formatVolume(price?.volume) ?? DASH}
            valueTitle={price?.volume != null ? `${formatCount(price.volume)} shares` : undefined}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile
            label="Market cap"
            value={formatMarketCap(price?.marketCap) ?? DASH}
            valueTitle={price?.marketCap != null ? `Rs ${formatCount(price.marketCap)}` : undefined}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile
            label="52-week range"
            value={
              price?.week52Low == null && price?.week52High == null
                ? DASH
                : `${formatNumber(price?.week52Low)} – ${formatNumber(price?.week52High)}`
            }
            footer={
              rangePct == null ? null : (
                <Box>
                  <LinearProgress
                    variant="determinate"
                    value={rangePct}
                    sx={{ height: 6, borderRadius: 1 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Today at {rangePct.toFixed(0)}% of the range
                  </Typography>
                </Box>
              )
            }
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile label="Open" value={formatNumber(price?.open)} />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile label="Day high" value={formatNumber(price?.high)} />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile label="Day low" value={formatNumber(price?.low)} />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatTile
            label="Last trade"
            value={formatDate(price?.lastTradeDate)}
            footer={
              price?.lastTradeDate ? (
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(price.lastTradeDate)}
                </Typography>
              ) : null
            }
          />
        </Grid>
      </Grid>

      <QuickJumpNav sections={SECTIONS} onOffsetChange={setScrollOffset} />

      <Stack spacing={3} sx={{ mt: 2 }}>
        <Box component="section" id="section-history" sx={{ scrollMarginTop: scrollOffset }}>
          <SectionCard
            title="Price history"
            subtitle={
              chartMode === 'tradingview'
                ? 'TradingView data, rendered by their widget — nothing scraped, nothing stored.'
                : chartMode === 'candles'
                  ? `Daily candles · showing ${range === 'MAX' ? 'all stored sessions' : rangeLabel(range)}`
                  : `Our stored sessions, ${rangeLabel(range)}`
            }
            action={
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                disabled={fetching}
                onClick={startFetch}
              >
                {fetching ? 'Fetching…' : 'Fetch historical data'}
              </Button>
            }
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.5}
              justifyContent="space-between"
              alignItems={{ md: 'center' }}
              sx={{ mb: 2 }}
            >
              <ToggleButtonGroup
                size="small"
                exclusive
                value={range}
                onChange={(_e, v) => v && setRange(v)}
                aria-label="History range"
                sx={{ flexWrap: 'wrap' }}
              >
                {RANGES.map((r) => (
                  <ToggleButton key={r.value} value={r.value}>
                    {r.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={chartMode}
                onChange={(_e, v: ChartMode | null) => v && setChartMode(v)}
                aria-label="Chart type"
              >
                <ToggleButton value="candles">Candles</ToggleButton>
                <ToggleButton value="line">Line</ToggleButton>
                <ToggleButton value="tradingview">TradingView</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            {fetching && (
              <Box sx={{ mb: 2 }}>
                <LinearProgress
                  variant={progressPct != null ? 'determinate' : 'indeterminate'}
                  value={progressPct ?? undefined}
                  aria-label="History fetch progress"
                />
                <Typography variant="caption" color="text.secondary">
                  {progressPct != null ? `${progressPct}% ` : ''}
                  {(histJob?.progress &&
                    typeof histJob.progress === 'object' &&
                    histJob.progress.note) ||
                    'starting…'}
                </Typography>
              </Box>
            )}
            {fetchHistory.isError && (
              <StatePanel
                kind="error"
                compact
                title="Could not start the history fetch"
                action={
                  <Button size="small" onClick={startFetch}>
                    Try again
                  </Button>
                }
              />
            )}
            {histJob?.state === 'failed' && !fetching && (
              <StatePanel
                kind="error"
                compact
                title="History fetch failed"
                description={histJob.failedReason ?? 'The job did not report why.'}
                action={
                  <Button size="small" onClick={startFetch}>
                    Retry
                  </Button>
                }
              />
            )}
            {!fetching && histJob?.state === 'completed' && histJob.returnValue && (
              <Typography variant="body2" color="success.main" sx={{ mb: 2 }}>
                Fetched {histJob.returnValue.persisted ?? 0} data points for{' '}
                {RANGES.find((r) => r.value === range)?.label}.
              </Typography>
            )}

            {chartMode === 'candles' ? (
              candlesLoading ? (
                <Skeleton variant="rounded" height={340} />
              ) : (
                <>
                  <CandleChart data={candles} range={range} height={isMobile ? 260 : 380} />
                  {candles && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="p"
                      sx={{ mt: 1 }}
                    >
                      {candles.count} daily candles stored ({candles.from ?? DASH} →{' '}
                      {candles.to ?? DASH}) · showing{' '}
                      {range === 'MAX' ? 'all of them' : rangeLabel(range)} — drag or scroll back for
                      earlier sessions
                      {candles.sanitised > 0 &&
                        ` · ${candles.sanitised} readings with impossible fields ignored`}
                      {candles.skipped > 0 &&
                        ` · ${candles.skipped} readings discarded as impossible`}
                    </Typography>
                  )}
                </>
              )
            ) : chartMode === 'tradingview' ? (
              <TradingViewChart symbol={symbol} height={isMobile ? 360 : 460} />
            ) : historyLoading ? (
              <Skeleton variant="rounded" height={320} />
            ) : chart.length > 1 ? (
              <LineChart
                height={isMobile ? 240 : 340}
                xAxis={[
                  {
                    scaleType: 'point',
                    data: chart.map((p) => formatDate(p.lastTradeDate)),
                    tickLabelStyle: { fontSize: 10 },
                  },
                ]}
                series={[
                  {
                    data: chart.map((p) => p.close as number),
                    label: 'Close',
                    color: theme.palette.primary.main,
                    showMark: false,
                  },
                ]}
              />
            ) : (
              <StatePanel
                kind="empty"
                compact
                title="No stored history for this range"
                description="Fetch it from PSX to fill the chart and the range controls."
                action={
                  <Button size="small" variant="contained" disabled={fetching} onClick={startFetch}>
                    Fetch historical data
                  </Button>
                }
              />
            )}
          </SectionCard>
        </Box>

        <Box component="section" id="section-fundamentals" sx={{ scrollMarginTop: scrollOffset }}>
          <FundamentalsPanel ratios={data.ratios} insights={data.insights} />
        </Box>

        <Box component="section" id="section-financials" sx={{ scrollMarginTop: scrollOffset }}>
          <SectionCard
            title="Financials"
            subtitle={`${data.financials.length} period${data.financials.length === 1 ? '' : 's'} on record`}
            flush
          >
            <DataTable
              columns={financialColumns}
              rows={data.financials}
              ariaLabel="Financials"
              rowKey={(f) => `${f.year}-${f.quarter ?? 'FY'}`}
              emptyTitle="No financials recorded"
              emptyDescription="The company page has not been scraped yet, or it publishes no quarterly accounts."
            />
          </SectionCard>
        </Box>

        <Box component="section" id="section-ratios" sx={{ scrollMarginTop: scrollOffset }}>
          <SectionCard
            title="Ratios"
            subtitle="As published on the company page · blank means the field was not on the page we read"
          >
            {data.ratios ? (
              <Grid container spacing={1.5}>
                {RATIO_TILES.map((r) => {
                  const raw = data.ratios?.[r.key];
                  const digits = r.suffix === '%' ? 1 : 2;
                  return (
                    <Grid item xs={6} sm={4} md={2} key={String(r.key)}>
                      <StatTile
                        label={r.label}
                        value={raw == null ? DASH : `${formatNumber(raw, {
                          minimumFractionDigits: digits,
                          maximumFractionDigits: digits,
                        })}${r.suffix ?? ''}`}
                      />
                    </Grid>
                  );
                })}
              </Grid>
            ) : (
              <StatePanel
                kind="empty"
                compact
                title="No ratios recorded"
                description="Sync the company page to pick up P/E, P/B, ROE and the rest."
              />
            )}
          </SectionCard>
        </Box>

        <Box component="section" id="section-dividends" sx={{ scrollMarginTop: scrollOffset }}>
          <SectionCard
            title="Dividends"
            subtitle={`${data.dividends.length} announcement${data.dividends.length === 1 ? '' : 's'} on record`}
            flush
          >
            <DataTable
              columns={dividendColumns}
              rows={data.dividends}
              ariaLabel="Dividends"
              rowKey={(d) => `${d.announcementDate ?? 'x'}-${d.dividend ?? 'x'}`}
              emptyTitle="No dividends recorded"
              emptyDescription="Nothing announced for this symbol in the periods we have scraped."
            />
          </SectionCard>
        </Box>
      </Stack>
    </Box>
  );
}
