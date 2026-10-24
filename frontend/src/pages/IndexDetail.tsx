import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Grid,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ChangePill } from '../components/ui/ChangePill';
import { DataTable, type Column } from '../components/ui/DataTable';
import { ShariahMark } from '../components/ui/ShariahMark';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatTile } from '../components/ui/StatTile';
import { StatePanel } from '../components/ui/StatePanel';
import { CandleChart } from '../components/CandleChart';
import { TradingViewChart } from '../components/TradingViewChart';
import { useIndex, useIndexCandles, useStocks } from '../api/hooks';
import { DASH, formatCount, formatDateTime, formatNumber, formatPoints, formatRelative } from '../lib/format';
import { isStaleReading } from '../lib/freshness';
import { indexMetaDescription, indexMetaTitle } from '../lib/seo';
import { usePageMeta } from '../lib/usePageMeta';
import type { HistoryRange, StockListItem } from '../types';

/**
 * The constituent table (#174). Heaviest first, because that is how a reader reads an index — the
 * names that move it, then the tail. Every row links to that stock's page through the table's own
 * `rowHref`, so a row is a link without a per-cell anchor.
 */
const CONSTITUENT_COLUMNS: Column<StockListItem>[] = [
  { key: 'symbol', header: 'Symbol', render: (s) => s.symbol, mobileRole: 'title' },
  {
    key: 'company',
    header: 'Company',
    render: (s) => s.companyName ?? DASH,
    noWrap: true,
    // The card's second line belongs to the name; as a labelled meta it read
    // "FFC Company Fauji Fertilizer Company Limited" in one run-on row.
    mobileRole: 'subtitle',
  },
  {
    key: 'price',
    header: 'Price',
    align: 'right',
    render: (s) => (s.currentPrice == null ? DASH : formatNumber(s.currentPrice)),
    mobileRole: 'value',
  },
  {
    key: 'change',
    header: 'Change',
    align: 'right',
    render: (s) => <ChangePill value={s.changePercent} variant="soft" />,
    mobileRole: 'meta',
  },
  {
    key: 'weight',
    header: 'Weight',
    align: 'right',
    hideBelow: 'md',
    render: (s) => (s.weight == null ? DASH : `${formatNumber(s.weight)}%`),
    mobileRole: 'meta',
  },
];

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: '3Y', label: '3Y' },
  { value: '5Y', label: '5Y' },
  { value: 'MAX', label: 'Max' },
];

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

/**
 * One index: the exchange's board figures, and its own chart.
 *
 * The candles come from our stored sessions (`/indices/:symbol/candles`), which for KSE-100
 * means five years and for the indices we started tracking later means a single bar — the
 * caption says how many rather than implying more. The TradingView view embeds their chart, which
 * has the full history of a PSX index today, so a thin series is not a dead end.
 */
export function IndexDetail() {
  const { symbol = '' } = useParams();
  const [range, setRange] = useState<HistoryRange>('1Y');
  const [mode, setMode] = useState<'candles' | 'tradingview'>('candles');
  const { data, isLoading, isError } = useIndex(symbol);
  const { data: candles, isLoading: candlesLoading } = useIndexCandles(symbol);
  // Constituents (#174): the tracked members of this index, heaviest first. This is the read the
  // dashboard's KSE-100 scope already uses, so no new endpoint — and it is called before the
  // loading/error returns below so the hook order never changes.
  const { data: constituentPage, isError: constituentsFailed } = useStocks(
    1,
    100,
    false,
    'weight',
    'desc',
    undefined,
    symbol,
  );
  const constituents = constituentPage?.items ?? [];

  // Per-index document head: tab title + meta description for on-page SEO.
  usePageMeta(
    data ? indexMetaTitle(data.symbol, data.name) : undefined,
    data
      ? indexMetaDescription(
          data.symbol,
          data.value,
          data.week52High,
          data.week52Low,
          data.return1y,
          data.returnYtd,
          data.marketCap,
        )
      : undefined,
  );

  if (isLoading) {
    return (
      <Box>
        <Skeleton height={44} width="45%" />
        <Skeleton height={24} width="30%" sx={{ mb: 2 }} />
        <Grid container spacing={1.5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Grid item xs={6} md={3} key={i}>
              <Skeleton variant="rounded" height={92} />
            </Grid>
          ))}
        </Grid>
        <Skeleton variant="rounded" height={360} sx={{ mt: 2 }} />
      </Box>
    );
  }

  if (isError || !data) {
    return (
      <StatePanel
        kind="error"
        title={`Could not load index ${symbol}`}
        description="It may not be tracked yet — the indices list shows every one the exchange publishes."
        action={
          <Button variant="contained" href="/#indices">
            Back to the market board
          </Button>
        }
      />
    );
  }

  const change = data.change;
  // Sessions the source gave only a level for: drawn as a line, and worth saying out loud rather
  // than letting the chart look like it is missing something.
  const closeOnly = candles?.items.filter((c) => c.open === null).length ?? 0;

  return (
    <Box>
      <PageHeader
        title={data.symbol}
        subtitle={data.name}
        crumbs={[{ label: 'Market board', to: '/' }, { label: data.symbol }]}
        meta={
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="baseline">
            <Typography variant="caption" color="text.secondary">
              {data.lastTradeDate
                ? `Exchange figures as of ${formatDateTime(data.lastTradeDate)}`
                : 'No board row stored yet'}
            </Typography>
            {/*
              When we last read this index — not the same question as the session above. A board that
              has stopped reading keeps serving its last session, so without this the page cannot be
              told apart from a live one; it is also the value a reader checks to know the data is
              current.
            */}
            {data.liveAt && (
              <Typography
                variant="caption"
                color={isStaleReading(data.liveAt) ? 'warning.main' : 'text.secondary'}
                title={formatDateTime(data.liveAt)}
              >
                · last updated {formatRelative(data.liveAt)}
              </Typography>
            )}
          </Stack>
        }
      />

      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={4}>
          <StatTile
            label="Level"
            value={formatNumber(data.value)}
            footer={
              <Stack direction="row" spacing={1} alignItems="center">
                <ChangePill value={data.changePercent} variant="soft" />
                {/* The point move, in the same green/red as the pill (#190). */}
                <Typography
                  variant="caption"
                  fontWeight={600}
                  sx={{
                    color:
                      change == null || change === 0
                        ? 'text.secondary'
                        : change > 0
                          ? 'success.main'
                          : 'error.main',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {change == null ? DASH : `${formatPoints(change)} pts`}
                </Typography>
              </Stack>
            }
          />
        </Grid>
        {/*
          The tile row leads with the session's close — the level the index is actually quoted at —
          because the previous close sitting under that first tile reads as the index's price while
          being a session out of date. The previous close is still what `change` is measured against
          and the API still serves it; it is just not the headline stat here.
        */}
        <Grid item xs={6} sm={3} md={2}>
          <StatTile label="Close" value={formatNumber(data.value)} />
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <StatTile label="Open" value={formatNumber(data.open)} />
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <StatTile label="Day high" value={formatNumber(data.high)} />
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <StatTile label="Day low" value={formatNumber(data.low)} />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatTile
            label="Volume"
            value={formatCount(data.volume)}
            valueTitle={data.volume != null ? `${formatCount(data.volume)} shares` : undefined}
          />
        </Grid>
      </Grid>

      <SectionCard
        reveal
        title="Index chart"
        subtitle={
          mode === 'tradingview'
            ? 'TradingView data, rendered by their widget — nothing scraped, nothing stored.'
            : `Daily candles · showing ${range === 'MAX' ? 'all stored sessions' : rangeLabel(range)}`
        }
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          alignItems={{ md: 'center' }}
          sx={{ mb: 2 }}
        >
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_e, v: 'candles' | 'tradingview' | null) => v && setMode(v)}
            aria-label="Chart type"
          >
            <ToggleButton value="candles">Candles</ToggleButton>
            <ToggleButton value="tradingview">TradingView</ToggleButton>
          </ToggleButtonGroup>
          {mode === 'candles' && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={range}
              onChange={(_e, v: HistoryRange | null) => v && setRange(v)}
              aria-label="History range"
              sx={{ flexWrap: 'wrap' }}
            >
              {RANGES.map((r) => (
                <ToggleButton key={r.value} value={r.value}>
                  {r.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
        </Stack>

        {mode === 'tradingview' ? (
          <TradingViewChart symbol={data.symbol} height={460} />
        ) : candlesLoading ? (
          <Skeleton variant="rounded" height={380} />
        ) : (
          <>
            <CandleChart data={candles} range={range} height={380} />
            {candles && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                {candles.count} daily sessions stored
                {candles.items.length > 0 &&
                  ` (${candles.items[0]!.time} → ${candles.items[candles.items.length - 1]!.time})`}
                {closeOnly > 0
                  ? ` — ${closeOnly} of them close-only, drawn as a line: the exchange publishes no open/high/low for those sessions and no reachable source carries it, so none is invented`
                  : ' — full open/high/low candles'}
              </Typography>
            )}
          </>
        )}
      </SectionCard>

      {/* Constituents (#174): the index's members, each row linking through to its stock page.
          A read that failed says so, so it cannot be mistaken for an index with no members. */}
      <Box sx={{ mt: 3 }}>
        <SectionCard
          reveal
          title="Constituents"
          subtitle={
            constituentsFailed
              ? 'Membership could not be read'
              : `${constituents.length} tracked member${constituents.length === 1 ? '' : 's'} · heaviest first`
          }
          flush
        >
          {constituentsFailed ? (
            <Box sx={{ p: 3 }}>
              <StatePanel
                kind="error"
                title="Could not read this index's membership"
                description="The membership request failed — that is not the same as this index having no members. Try again in a moment."
              />
            </Box>
          ) : (
            <DataTable
              rowBadge={(r) => (r.shariahCompliant ? <ShariahMark /> : null)}
              columns={CONSTITUENT_COLUMNS}
              rows={constituents}
              ariaLabel={`${data.symbol} constituents`}
              rowKey={(s) => s.symbol}
              rowHref={(s) => `/stocks/${encodeURIComponent(s.symbol)}`}
              emptyTitle="No tracked constituents"
              emptyDescription="We hold no membership rows for this index yet, so there are no stock pages to link to. Indices whose membership we have not read show this rather than an empty table."
            />
          )}
        </SectionCard>
      </Box>
    </Box>
  );
}
