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
import { IncomeStatementPanel } from '../components/IncomeStatementPanel';
import { HoldingButton } from '../components/HoldingDialog';
import { QuickJumpNav, type QuickJumpSection } from '../components/QuickJumpNav';
import { ChangePill } from '../components/ui/ChangePill';
import { DataTable, type Column } from '../components/ui/DataTable';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatTile } from '../components/ui/StatTile';
import { StatePanel } from '../components/ui/StatePanel';
import {
  DASH,
  GLYPH,
  formatCount,
  formatDate,
  formatDateTime,
  formatMarketCap,
  formatNumber,
  formatPercent,
  formatVolume,
} from '../lib/format';
import { seriesTrend } from '../lib/seriesTrend';
import { stockMetaDescription, stockMetaTitle } from '../lib/seo';
import { isDev } from '../lib/env';
import { usePageMeta } from '../lib/usePageMeta';
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

/**
 * Both our views draw the sessions we have stored — the line is the plainest read of the closes
 * and is what the page opens on; the candle view adds the OHLC body and volume. TradingView is
 * their widget, rendered live.
 */
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

type Dividend = StockDetail['dividends'][number];

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
  const [chartMode, setChartMode] = useState<ChartMode>('line');
  const { data: candles, isLoading: candlesLoading } = useCandles(symbol);
  const syncStock = useSyncStock();
  const { data: status } = useSyncStatus(syncStock.isPending);
  // Sticky header + quick-jump nav height, reported by the nav so anchors scroll below both bars.
  const [scrollOffset, setScrollOffset] = useState(0);

  // Historical fetch job + live progress
  const fetchHistory = useFetchHistory(symbol);
  const [fetching, setFetching] = useState(false);
  const { data: histJob } = useHistoryStatus(symbol, fetching);

  // Per-stock document head: tab title + meta description for on-page SEO (all 508 stocks).
  usePageMeta(
    data
      ? stockMetaTitle(data.symbol, data.price?.currentPrice, data.companyName)
      : undefined,
    data
      ? stockMetaDescription(
          data.symbol,
          data.price?.currentPrice,
          data.price?.changePercent,
          data.price?.high,
          data.price?.low,
        )
      : undefined,
  );

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

  // The window's own direction — first reading to last — which is what tones the line and the wash
  // beneath it. Read off the same series the chart draws, so the colour can never describe a
  // different window than the line does. Deliberately not `trendOf`: see `seriesTrend`.
  const lineTrend = seriesTrend(chart.map((p) => p.close));
  // Two token families, because they answer to two different thresholds: `chart.*` is contrast-checked
  // for graphical marks (3:1), while the caption's figure is text and takes the `up`/`down` pair,
  // which clears 4.5:1.
  const lineColor =
    lineTrend?.trend === 'up'
      ? theme.palette.chart.up
      : lineTrend?.trend === 'down'
        ? theme.palette.chart.down
        : theme.palette.text.secondary;
  const lineTextColor =
    lineTrend?.trend === 'up'
      ? theme.palette.up.main
      : lineTrend?.trend === 'down'
        ? theme.palette.down.main
        : theme.palette.text.secondary;

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
            {isDev && data.lastSync && (
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
          <>
            {isDev && (
              <Button
                variant="contained"
                startIcon={<SyncIcon />}
                disabled={syncing}
                onClick={() => syncStock.mutate(symbol)}
              >
                {syncing ? 'Syncing…' : 'Sync latest data'}
              </Button>
            )}
            <HoldingButton symbol={symbol} />
          </>
        }
      />

      {isDev && syncing && <LinearProgress sx={{ mb: 2 }} />}

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
                : chartMode === 'line'
                  ? `Our stored sessions, ${rangeLabel(range)}`
                  : `Daily candles · showing ${range === 'MAX' ? 'all stored sessions' : rangeLabel(range)}`
            }
            action={
              isDev ? (
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  disabled={fetching}
                  onClick={startFetch}
                >
                  {fetching ? 'Fetching…' : 'Fetch historical data'}
                </Button>
              ) : undefined
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
                <ToggleButton value="line">Line</ToggleButton>
                <ToggleButton value="candles">Candles</ToggleButton>
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

            {chartMode === 'line' ? (
              historyLoading ? (
                <Skeleton variant="rounded" height={320} />
              ) : chart.length > 1 ? (
                <>
                  <LineChart
                    height={isMobile ? 240 : 340}
                    xAxis={[
                      {
                        scaleType: 'point',
                        data: chart.map((p) => formatDate(p.lastTradeDate)),
                        tickLabelStyle: { fontSize: 10 },
                      },
                    ]}
                    // Left alone, MUI X paints the area as the series colour brightened by 0.5 at
                    // full opacity — a solid block that swallows the line and the gridlines. The
                    // fill is set here instead, to the same token the stroke uses, as a low wash.
                    sx={{
                      '& .MuiAreaElement-root': { fill: lineColor, fillOpacity: 0.12 },
                    }}
                    series={[
                      {
                        data: chart.map((p) => p.close as number),
                        label: 'Close',
                        color: lineColor,
                        // The wash under the line is what makes the window's shape readable at a
                        // glance. `'min'` fills down to the axis rather than to zero: a price series
                        // never reaches zero, and anchoring the fill there would squash the whole
                        // shape into the top of the box.
                        area: true,
                        baseline: 'min',
                        showMark: false,
                      },
                    ]}
                  />
                  {lineTrend && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="p"
                      sx={{ mt: 1 }}
                    >
                      <Box
                        component="span"
                        sx={{
                          color: lineTextColor,
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {GLYPH[lineTrend.trend]} {formatPercent(lineTrend.changePercent)}
                      </Box>{' '}
                      over {range === 'MAX' ? 'all stored sessions' : rangeLabel(range)} ·{' '}
                      {formatNumber(lineTrend.first)} → {formatNumber(lineTrend.last)}
                    </Typography>
                  )}
                </>
              ) : (
                <StatePanel
                  kind="empty"
                  compact
                  title="No stored history for this range"
                  description={
                    isDev
                      ? 'Fetch it from PSX to fill the chart and the range controls.'
                      : 'No historical prices are stored for this range yet.'
                  }
                  action={
                    isDev ? (
                      <Button
                        size="small"
                        variant="contained"
                        disabled={fetching}
                        onClick={startFetch}
                      >
                        Fetch historical data
                      </Button>
                    ) : undefined
                  }
                />
              )
            ) : chartMode === 'candles' ? (
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
            ) : (
              <TradingViewChart symbol={symbol} height={isMobile ? 360 : 460} />
            )}
          </SectionCard>
        </Box>

        <Box component="section" id="section-fundamentals" sx={{ scrollMarginTop: scrollOffset }}>
          <FundamentalsPanel ratios={data.ratios} insights={data.insights} />
        </Box>

        <Box component="section" id="section-financials" sx={{ scrollMarginTop: scrollOffset }}>
          <IncomeStatementPanel statement={data.incomeStatement} />
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
