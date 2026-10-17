import { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useIndicators } from '../api/hooks';
import { SectionCard } from './ui/SectionCard';
import { DASH, formatNumber } from '../lib/format';
import type { HistoryRange, IndicatorSeries } from '../types';

/**
 * The technical section: RSI, MACD and the definitions behind them.
 *
 * Deliberately not a signal panel. Every number is labelled as an estimate computed from unadjusted
 * closes over a stated window, and the wording never says buy, sell, overbought as advice or
 * "momentum is turning" — the page reports arithmetic, the reader decides what it means.
 */

function fmt(v: number | null | undefined, digits = 2): string {
  return v == null ? DASH : formatNumber(v, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Last element, or null — `Array.prototype.at` is not in this project's lib target. */
const last = <T,>(xs: T[]): T | null => (xs.length ? xs[xs.length - 1] : null);

/**
 * One or more lines on a **shared** vertical scale, with optional bars around zero.
 *
 * Sharing the scale matters: MACD and its signal line are compared by whether one is above the
 * other, and drawing them as two independently-scaled charts would make the crossing point — the
 * only thing the pair is for — invisible.
 */
function MultiSparkline({
  lines,
  bars,
  height = 96,
  guides = [],
}: {
  lines: { points: Array<number | null>; colour: string }[];
  bars?: Array<number | null>;
  height?: number;
  guides?: number[];
}) {
  const values = lines.flatMap((l) => l.points.filter((v): v is number => v != null));
  const barValues = (bars ?? []).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const all = [...values, ...barValues, ...guides, 0];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const w = 100;
  const n = Math.max(...lines.map((l) => l.points.length), bars?.length ?? 0);
  const x = (i: number) => (i / Math.max(n - 1, 1)) * w;
  const y = (v: number) => height - ((v - min) / span) * height;
  const bw = w / Math.max(bars?.length ?? 0, 1);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true">
      {guides.map((g) => (
        <line key={g} x1={0} x2={w} y1={y(g)} y2={y(g)} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 2" />
      ))}
      {bars?.map((v, i) =>
        v == null ? null : (
          <rect
            key={`b${i}`}
            x={i * bw}
            y={v >= 0 ? y(v) : y(0)}
            width={Math.max(bw - 0.4, 0.4)}
            height={Math.abs(y(v) - y(0))}
            fill="currentColor"
            opacity={0.35}
          />
        ),
      )}
      {lines.map((l, li) => (
        <polyline
          key={`l${li}`}
          points={l.points
            .map((v, i) => (v == null ? null : `${x(i).toFixed(2)},${y(v).toFixed(2)}`))
            .filter((p): p is string => p != null)
            .join(' ')}
          fill="none"
          stroke={l.colour}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function pick(series: IndicatorSeries[] | undefined, name: string, param?: number): IndicatorSeries | undefined {
  return series?.find((s) => s.name === name && (param == null || s.params.period === param));
}

/** "RSI 61.4 · below the 50-session SMA" — the summary a screen reader (and a glance) can use. */
function summarise(series: IndicatorSeries[] | undefined): string {
  if (!series?.length) return 'Technical indicators are not available for this range.';
  const rsi = last(pick(series, 'RSI')?.points ?? [])?.value ?? null;
  const sma50 = last(pick(series, 'SMA', 50)?.points ?? [])?.value ?? null;
  const close = last(pick(series, 'Bollinger middle', 20)?.points ?? [])?.value ?? null;
  const macdLine = last(pick(series, 'MACD')?.points ?? [])?.value ?? null;
  const signal = last(pick(series, 'MACD signal')?.points ?? [])?.value ?? null;

  const parts: string[] = [];
  if (rsi != null) parts.push(`RSI(14) ${fmt(rsi, 1)}`);
  // The 50-session SMA is compared with the latest close, which is what the reader is looking at.
  if (sma50 != null) parts.push(`close ${close != null && close >= sma50 ? 'above' : 'below'} the 50-session SMA of ${fmt(sma50)}`);
  if (macdLine != null && signal != null) parts.push(`MACD ${macdLine >= signal ? 'above' : 'below'} its signal line`);
  return parts.length ? `${parts.join(' · ')}.` : 'No indicator has enough history for this range yet.';
}

export function TechnicalSection({ symbol, range }: { symbol: string; range: HistoryRange }) {
  const { data, isLoading, error, refetch } = useIndicators(symbol, range);
  const [defsOpen, setDefsOpen] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const palette = theme.palette.chart;

  const series = data?.series;
  const rsi = pick(series, 'RSI');
  const sma50 = pick(series, 'SMA', 50);
  const macdLine = pick(series, 'MACD');
  const macdSignal = pick(series, 'MACD signal');
  const histogram = pick(series, 'MACD histogram');
  const atr = pick(series, 'ATR');

  const summary = useMemo(() => summarise(series), [series]);

  const rsiPoints = rsi?.points.map((p) => p.value) ?? [];
  const macdPoints = macdLine?.points.map((p) => p.value) ?? [];
  const signalPoints = macdSignal?.points.map((p) => p.value) ?? [];
  const histPoints = histogram?.points.map((p) => p.value) ?? [];

  return (
    <SectionCard
        title="Technical"
      subtitle={`Computed from unadjusted closes over ${range} · arithmetic, not a forecast`}
      action={
        <ToggleButtonGroup
          size="small"
          value={defsOpen ? 'defs' : ''}
          exclusive
          onChange={(_, v) => setDefsOpen(v === 'defs')}
        >
          <ToggleButton value="defs" sx={{ textTransform: 'none', px: 1.5 }}>
            Definitions
          </ToggleButton>
        </ToggleButtonGroup>
      }
    >
      {error ? (
        <Alert severity="error" action={<Chip label="Retry" onClick={() => refetch()} size="small" />}>
          Could not load indicators for {symbol}.
        </Alert>
      ) : isLoading ? (
        <Typography variant="body2" color="text.secondary">
          Loading indicators…
        </Typography>
      ) : (
        <Stack spacing={2}>
          {/* The single sentence that carries the whole section for a screen reader. */}
          <Typography variant="body2" aria-live="polite">
            {summary}
          </Typography>

          {/* RSI */}
          {rsi?.insufficientData ? (
            <PanelUnavailable label={`RSI(14)`} required={rsi.requiredSessions} available={rsi.availableSessions} />
          ) : (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                RSI(14) · Wilder · last {fmt(last(rsi?.points ?? [])?.value ?? null, 1)}
              </Typography>
              <Box sx={{ color: palette.text }}>
                <MultiSparkline
                  lines={[{ points: rsiPoints, colour: palette.gold }]}
                  guides={[30, 70]}
                  height={isMobile ? 80 : 96}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                30 and 70 are the conventional reference bands, not a recommendation. Window:{' '}
                {rsi?.windowStart ?? DASH} to {rsi?.windowEnd ?? DASH}.
              </Typography>
            </Box>
          )}

          {/* MACD */}
          {macdLine?.insufficientData ? (
            <PanelUnavailable
              label="MACD(12,26,9)"
              required={macdLine.requiredSessions}
              available={macdLine.availableSessions}
            />
          ) : (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                MACD(12,26,9) · {fmt(last(macdPoints) ?? null)} · signal {fmt(last(signalPoints) ?? null)}
              </Typography>
              <Box sx={{ color: palette.text }}>
                <MultiSparkline
                  lines={[
                    { points: macdPoints, colour: palette.up },
                    { points: signalPoints, colour: palette.down },
                  ]}
                  bars={histPoints}
                  height={isMobile ? 110 : 140}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                The signal line is an EMA(9) of the MACD line; the bars are their gap.
              </Typography>
            </Box>
          )}

          <Typography variant="caption" color="text.secondary">
            Prices are as stored (no split or dividend adjustment), so a long window can show a jump
            at a corporate action.                 {atr && !atr.insufficientData && last(atr.points)?.value != null
                  ? `ATR(14) ${fmt(last(atr.points)?.value ?? null)}.`
                  : ''}
          </Typography>

          {defsOpen ? (
            <Box>
              {(series ?? []).map((s) => (
                <Accordion key={`${s.name}-${JSON.stringify(s.params)}`} disableGutters elevation={0}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="body2">
                      {s.name}
                      {Object.entries(s.params).map(([k, v]) => ` · ${k} ${v}`).join('')}
                      {s.insufficientData ? ' · insufficient history' : ''}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Typography variant="caption" color="text.secondary" component="div">
                      Parameters: {JSON.stringify(s.params)} · needs {s.requiredSessions} sessions, has{' '}
                      {s.availableSessions} · window {s.windowStart ?? '—'} to {s.windowEnd ?? '—'} ·{' '}
                      {s.unadjusted ? 'unadjusted prices' : 'adjusted prices'}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          ) : null}

          {sma50 && !sma50.insufficientData ? (
            <Typography variant="caption" color="text.secondary">
              The 50-session SMA compared above is part of the same series the chart draws.
            </Typography>
          ) : null}
        </Stack>
      )}
    </SectionCard>
  );
}

function PanelUnavailable({ label, required, available }: { label: string; required: number; available: number }) {
  return (
    <Box sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Typography variant="subtitle2">{label} unavailable</Typography>
      <Typography variant="caption" color="text.secondary">
        This range holds {available} sessions; the indicator needs {required}. Widen the range to see
        it — an empty axis would suggest the value is zero.
      </Typography>
    </Box>
  );
}
