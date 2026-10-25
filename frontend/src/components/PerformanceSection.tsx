import { useState } from 'react';
import { Box, Chip, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import { usePerformance } from '../api/hooks';
import { SectionCard } from './ui/SectionCard';
import { ChangePill } from './ui/ChangePill';
import { DASH } from '../lib/format';
import type { HistoryRange } from '../types';

/**
 * Period returns and a comparison against an index.
 *
 * The comparison is rebased — both legs start at 100 on the first session they share — because an
 * index at 166,000 next to a share at 517 would otherwise look like a vertical cliff. The legend
 * names the index and the base date, so the picture cannot be read as absolute prices.
 *
 * There is no 1D range here on purpose: `stock_prices` holds one row per session, so a 1D line
 * would be a single point drawn as a flat line. The range control doesn't offer it, and this
 * component never invents intraday shape.
 */

const RANGES: HistoryRange[] = ['1M', '6M', '1Y', '3Y'];

function PerfChart({
  points,
  symbol,
  indexName,
  baseDate,
}: {
  points: { date: string; stock: number; index: number }[];
  symbol: string;
  indexName: string;
  baseDate: string | null;
}) {
  const theme = useTheme();
  const palette = theme.palette.chart;
  if (points.length < 2) return null;
  const all = points.flatMap((p) => [p.stock, p.index]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const w = 100;
  const h = 100;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * h;
  const path = (key: 'stock' | 'index') =>
    points.map((p, i) => `${x(i).toFixed(2)},${y(p[key]).toFixed(2)}`).join(' ');

  const stockGain = points[points.length - 1].stock - 100;
  const indexGain = points[points.length - 1].index - 100;

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 10, height: 2, bgcolor: palette.up, display: 'inline-block' }} />
          {symbol} {stockGain >= 0 ? '+' : ''}
          {stockGain.toFixed(1)}% since {baseDate ?? 'the first session'}
        </Typography>
        <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 14, height: 0, display: 'inline-block', borderTop: `2px dashed ${palette.gold}` }} />
          {indexName} {indexGain >= 0 ? '+' : ''}
          {indexGain.toFixed(1)}% since {baseDate ?? 'the first session'}
        </Typography>
      </Box>
      <Box sx={{ color: 'text.primary' }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={160} role="img"
          aria-label={`${symbol} against ${indexName}, both rebased to 100 on ${baseDate ?? 'the first session'}`}>
          <line x1={0} x2={w} y1={y(100)} y2={y(100)} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="2 2" />
          {/* Dashed, so the index is identifiable without relying on the gold/green difference. */}
          <polyline points={path('index')} fill="none" stroke={palette.gold} strokeWidth={1.4} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
          <polyline points={path('stock')} fill="none" stroke={palette.up} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        </svg>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Both series are rebased to 100 on {baseDate ?? 'the first shared session'} — this compares
        shape, not price level. The chart starts on the range's first plotted session, which can be
        a day either side of the return pills' window.
      </Typography>
    </Box>
  );
}

export function PerformanceSection({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<HistoryRange>('1Y');
  const { data, isLoading, error } = usePerformance(symbol, range, 'KSE100');

  return (
    <SectionCard
      title="Performance"
      subtitle="Price return, dividends excluded · returns counted in sessions"
      action={
        <Stack direction="row" spacing={0.5}>
          {RANGES.map((r) => (
            <Chip
              key={r}
              size="small"
              label={r}
              color={r === range ? 'primary' : 'default'}
              variant={r === range ? 'filled' : 'outlined'}
              onClick={() => setRange(r)}
            />
          ))}
        </Stack>
      }
    >
      {error ? (
        <Typography variant="body2" color="text.secondary">
          Performance data is unavailable for {symbol}.
        </Typography>
      ) : isLoading || !data ? (
        <Typography variant="body2" color="text.secondary">
          Loading performance…
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {data.returns.map((r) => (
              <Tooltip
                key={r.period}
                title={
                  r.value == null
                    ? `Needs ${r.sessions} sessions; ${symbol} has ${r.available ?? 0} in this window.`
                    : `${r.sessions} sessions${r.available != null && r.available < r.sessions ? ` (capped at ${r.available})` : ''}`
                }
              >
                <Box sx={{ minWidth: 74 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {r.period.toUpperCase()}
                  </Typography>
                  {r.value == null ? (
                    <Typography variant="body2" color="text.secondary">
                      {DASH}
                    </Typography>
                  ) : (
                    <ChangePill value={r.value} size="sm" />
                  )}
                </Box>
              </Tooltip>
            ))}
          </Stack>

          {data.benchmark ? (
            <PerfChart
              points={data.benchmark.points}
              symbol={data.symbol}
              indexName={data.benchmark.index.name}
              baseDate={data.benchmark.baseDate}
            />
          ) : (
            <Typography variant="caption" color="text.secondary">
              No index comparison for this range — the index has no stored values over it.
            </Typography>
          )}
          {data.benchmark?.carried ? (
            <Typography variant="caption" color="text.secondary">
              The index had no value on the first session; the previous close was used as the base.
            </Typography>
          ) : null}
        </Stack>
      )}
    </SectionCard>
  );
}
