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
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatTile } from '../components/ui/StatTile';
import { StatePanel } from '../components/ui/StatePanel';
import { CandleChart } from '../components/CandleChart';
import { TradingViewChart } from '../components/TradingViewChart';
import { useIndex, useIndexCandles } from '../api/hooks';
import { DASH, formatCount, formatDateTime, formatNumber } from '../lib/format';
import type { HistoryRange } from '../types';

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
          <Typography variant="caption" color="text.secondary">
            {data.lastTradeDate
              ? `Exchange figures as of ${formatDateTime(data.lastTradeDate)}`
              : 'No board row stored yet'}
          </Typography>
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
                <Typography variant="caption" color="text.secondary">
                  {change == null ? DASH : `${change > 0 ? '+' : ''}${formatNumber(change)}`}
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
    </Box>
  );
}
