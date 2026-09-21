import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Grid, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { CandleChart } from '../components/CandleChart';
import { TradingViewChart } from '../components/TradingViewChart';
import { useIndex, useIndexCandles } from '../api/hooks';
import type { HistoryRange } from '../types';

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '1W', label: '1W' }, { value: '1M', label: '1M' }, { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' }, { value: '3Y', label: '3Y' }, { value: '5Y', label: '5Y' },
  { value: 'MAX', label: 'Max' },
];

const rangeLabel = (r: HistoryRange): string =>
  ({ '1W': 'past 1 week', '1M': 'past 1 month', '6M': 'past 6 months', '1Y': 'past 1 year',
     '3Y': 'past 3 years', '5Y': 'past 5 years', MAX: 'all stored sessions' } as Record<HistoryRange, string>)[r];

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <Grid item xs={6} sm={4} md={3}>
      <Card variant="outlined">
        <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="h6" sx={{ fontSize: 17, color: tone }}>{value}</Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}

const fmt = (v: number | null | undefined, dp = 2): string =>
  v === null || v === undefined ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * One index: the exchange's board figures, and its own chart.
 *
 * The candles come from our stored sessions (`/indices/:symbol/candles`), which for KSE-100
 * means five years and for the indices we started tracking today means a single bar — the
 * caption says how many rather than implying more. The TradingView tab embeds their chart, which
 * has the full history of a PSX index today, so a thin series is not a dead end.
 */
export function IndexDetail() {
  const { symbol = '' } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState<HistoryRange>('1Y');
  const [mode, setMode] = useState<'candles' | 'tradingview'>('candles');
  const { data, isLoading, isError } = useIndex(symbol);
  const { data: candles, isLoading: candlesLoading } = useIndexCandles(symbol);

  if (isLoading) return <Box><Skeleton height={60} /><Skeleton height={240} /></Box>;
  if (isError || !data) return <Alert severity="error">Could not load index {symbol}. It may not be tracked yet.</Alert>;

  const change = data.change;
  const tone = change === null ? undefined : change > 0 ? 'success.main' : change < 0 ? 'error.main' : undefined;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={1}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/')}>Dashboard</Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} mb={2}>
        <Box>
          <Typography variant="h4">{data.symbol}</Typography>
          <Typography variant="body2" color="text.secondary">{data.name}</Typography>
        </Box>
        <Box textAlign={{ sm: 'right' }}>
          <Typography variant="h5">{fmt(data.value)}</Typography>
          <Typography variant="body2" sx={{ color: tone }}>
            {change === null ? '—' : `${change > 0 ? '▲' : change < 0 ? '▼' : '·'} ${fmt(change)}${data.changePercent === null ? '' : ` (${data.changePercent.toFixed(2)}%)`}`}
          </Typography>
        </Box>
      </Stack>

      <Grid container spacing={1} mb={2}>
        <Stat label="Previous close" value={fmt(data.previousClose)} />
        <Stat label="Open" value={fmt(data.open)} />
        <Stat label="Day high" value={fmt(data.high)} />
        <Stat label="Day low" value={fmt(data.low)} />
        <Stat label="Volume" value={data.volume === null ? '—' : data.volume.toLocaleString()} />
        <Stat label="Change %" value={data.changePercent === null ? '—' : `${data.changePercent.toFixed(2)}%`} tone={tone} />
        <Stat label="Last updated" value={data.lastTradeDate ? new Date(data.lastTradeDate).toLocaleString() : '—'} />
      </Grid>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_e, v: 'candles' | 'tradingview' | null) => v && setMode(v)} aria-label="chart type">
          <ToggleButton value="candles">Candles</ToggleButton>
          <ToggleButton value="tradingview">TradingView</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'candles' && (
          <ToggleButtonGroup size="small" exclusive value={range} onChange={(_e, v: HistoryRange | null) => v && setRange(v)} aria-label="history range">
            {RANGES.map((r) => <ToggleButton key={r.value} value={r.value}>{r.label}</ToggleButton>)}
          </ToggleButtonGroup>
        )}
        <Typography variant="caption" color="text.secondary">
          {mode === 'tradingview' ? 'TradingView data, rendered by their widget' : `Daily candles · showing ${range === 'MAX' ? 'all stored sessions' : rangeLabel(range)}`}
        </Typography>
      </Stack>

      {mode === 'tradingview' ? (
        <TradingViewChart symbol={data.symbol} height={460} />
      ) : candlesLoading ? (
        <Skeleton height={380} />
      ) : (
        <>
          <CandleChart data={candles} range={range} height={380} />
          {candles && (
            <Typography variant="caption" color="text.secondary">
              {candles.count} daily candles stored
              {candles.items.length > 0 && ` (${candles.items[0]!.time} → ${candles.items[candles.items.length - 1]!.time})`}
              {' '}— index history is whatever we have collected, so a young series is expected for indices added recently
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}
