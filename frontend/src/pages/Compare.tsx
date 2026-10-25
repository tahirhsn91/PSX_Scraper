import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  Alert,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useCompare, useStocks } from '../api/hooks';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatePanel } from '../components/ui/StatePanel';
import { ChangePill } from '../components/ui/ChangePill';
import { formatCount, formatMarketCap, formatNumber, DASH } from '../lib/format';
import type { StockListItem } from '../types';

const MAX = 5;

/** One comparison row: a label and how to render it for a given stock. */
interface Metric {
  label: string;
  render: (s: StockListItem) => React.ReactNode;
}

const METRICS: Metric[] = [
  { label: 'Price', render: (s) => formatNumber(s.currentPrice) },
  { label: '1Y return', render: (s) => <ChangePill value={s.periodReturn} /> },
  { label: 'RSI (14)', render: (s) => (s.rsi != null ? formatNumber(s.rsi, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : DASH) },
  { label: 'Change', render: (s) => <ChangePill value={s.changePercent} /> },
  { label: 'Market cap', render: (s) => formatMarketCap(s.marketCap) ?? DASH },
  { label: 'Volume', render: (s) => formatCount(s.volume) },
  { label: '52-week high', render: (s) => formatNumber(s.week52High) },
  { label: '52-week low', render: (s) => formatNumber(s.week52Low) },
  { label: 'P/E', render: (s) => formatNumber(s.peRatio) },
  { label: 'P/B', render: (s) => formatNumber(s.pbRatio) },
  { label: 'Dividend yield', render: (s) => (s.dividendYield != null ? `${formatNumber(s.dividendYield)}%` : DASH) },
  { label: 'ROE', render: (s) => (s.roe != null ? `${formatNumber(s.roe)}%` : DASH) },
  { label: 'Beta', render: (s) => formatNumber(s.beta) },
  { label: 'Debt / equity', render: (s) => formatNumber(s.debtToEquity) },
  { label: 'EPS', render: (s) => formatNumber(s.eps) },
];

const SYMBOL_RE = /^[A-Z0-9.-]{1,20}$/;

/**
 * Side-by-side comparison of up to five symbols. Fetched through the list endpoint's `symbols`
 * filter (one request), so a symbol that does not resolve simply shows the dash in its column.
 */

/**
 * Up to five rebased lines on one axis.
 *
 * The chart is decorative — the same numbers are in the legend and in the statistics table beneath
 * it, and `answer` carries the comparison as a sentence for anyone who cannot see the lines.
 */
function CompareChart({
  series,
  answer,
}: {
  series: { symbol: string; points: { date: string; value: number }[]; returnPct: number }[];
  answer: string;
}) {
  // Five hues that stay distinguishable in sequence — reusing the up/down palette would paint two
  // symbols the same green and make the lines unreadable exactly where they cross.
  const colours = ['#2E7D32', '#F9A825', '#C62828', '#1565C0', '#6A1B9A'];
  // Paired with the hues: solid, long dash, short dash, dash-dot, dotted. A reader who cannot tell
  // green from red can still follow one line across the chart.
  const DASHES = [undefined, '6 3', '2 2', '8 3 2 3', '1 3'];
  const all = series.flatMap((s) => s.points.map((p) => p.value));
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const w = 100;
  const h = 100;
  const n = Math.max(...series.map((s) => s.points.length));

  return (
    <Box>
      <Box component="svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={240}
        role="img" aria-label={answer}>
        <line x1={0} x2={w} y1={h - ((100 - min) / span) * h} y2={h - ((100 - min) / span) * h}
          stroke="currentColor" strokeOpacity={0.2} strokeDasharray="2 2" />
        {series.map((s, i) => (
          <polyline
            key={s.symbol}
            fill="none"
            stroke={colours[i % colours.length]}
            // Colour alone cannot separate the lines for a colour-blind reader: each series also
            // gets its own dash pattern, repeated on the legend swatch below.
            strokeDasharray={DASHES[i % DASHES.length]}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
            points={s.points
              .map((p, j) => `${((j / Math.max(n - 1, 1)) * w).toFixed(2)},${(h - ((p.value - min) / span) * h).toFixed(2)}`)
              .join(' ')}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
        {series.map((s, i) => (
          <Typography key={s.symbol} variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              sx={{
                width: 14,
                height: 0,
                display: 'inline-block',
                borderTop: `2px ${DASHES[i % DASHES.length] ? 'dashed' : 'solid'} ${colours[i % colours.length]}`,
              }}
            />
            {s.symbol} {s.returnPct >= 0 ? '+' : ''}
            {s.returnPct.toFixed(1)}%
          </Typography>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {series[0]?.points[0]?.date ?? ''}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {series[0]?.points[series[0].points.length - 1]?.date ?? ''}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {answer}
      </Typography>
    </Box>
  );
}

export function Compare() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  // One period for every line: mixed windows would not be a comparison.
  const [period, setPeriod] = useState<'1m' | '3m' | '6m' | '1y' | '3y'>('1y');
  const { data: comparison } = useCompare(symbols, period);

  const { data, isLoading } = useStocks(
    1,
    MAX,
    false,
    undefined,
    'asc',
    undefined,
    undefined,
    symbols.length > 0 ? { symbols, technical: true, returnPeriod: '1y' } : undefined,
  );

  // Preserve the user's order, which the API may not (it sorts by symbol).
  const rows = symbols
    .map((sym) => (data?.items ?? []).find((s) => s.symbol === sym))
    .filter((s): s is StockListItem => Boolean(s));

  const add = () => {
    const sym = input.trim().toUpperCase();
    if (!SYMBOL_RE.test(sym)) {
      setHint('Enter a symbol like ENGROH or HBL.');
      return;
    }
    if (symbols.includes(sym)) {
      setHint(`${sym} is already in the comparison.`);
      return;
    }
    if (symbols.length >= MAX) {
      setHint(`Compare up to ${MAX} symbols.`);
      return;
    }
    setSymbols((s) => [...s, sym]);
    setInput('');
    setHint(null);
  };

  const remove = (sym: string) => setSymbols((s) => s.filter((x) => x !== sym));

  return (
    <>
      <PageHeader title="Compare" subtitle={`Line up to ${MAX} stocks side by side`} />
      <SectionCard sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" useFlexGap sx={{ flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Add a symbol"
            placeholder="e.g. ENGROH"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            sx={{ width: 180 }}
          />
          <Button variant="contained" onClick={add} disabled={symbols.length >= MAX}>
            Add
          </Button>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {symbols.map((sym) => (
              <Chip key={sym} label={sym} onDelete={() => remove(sym)} />
            ))}
          </Box>
        </Stack>
        {hint && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {hint}
          </Typography>
        )}
      </SectionCard>

      {symbols.length >= 2 ? (
        <SectionCard
          title="Normalised performance"
          subtitle={
            comparison?.windowStart
              ? `All lines rebased to 100 on ${comparison.windowStart} · ${comparison.windowEnd} · ${comparison.series[0]?.sessions ?? 0} sessions`
              : 'Waiting for overlapping history'
          }
          action={
            <Stack direction="row" spacing={0.5}>
              {(['1m', '3m', '6m', '1y', '3y'] as const).map((p) => (
                <Chip
                  key={p}
                  size="small"
                  label={p.toUpperCase()}
                  color={p === period ? 'primary' : 'default'}
                  variant={p === period ? 'filled' : 'outlined'}
                  onClick={() => setPeriod(p)}
                />
              ))}
            </Stack>
          }
          sx={{ mb: 3 }}
        >
          {comparison && comparison.series.length >= 2 ? (
            <CompareChart
              series={comparison.series}
              answer={`${comparison.series
                .map((s) => `${s.symbol} ${s.returnPct >= 0 ? 'up' : 'down'} ${Math.abs(s.returnPct).toFixed(1)} percent`)
                .join(', ')} over ${comparison.series[0]?.sessions ?? 0} sessions.`}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {comparison
                ? 'These symbols do not share a window long enough to compare.'
                : 'Loading comparison…'}
            </Typography>
          )}
          {comparison && (comparison.excluded.length > 0 || (comparison.shortenedBy?.length ?? 0) > 0) ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              {comparison.excluded.map((e) => `${e.symbol}: ${e.reason}`).join(' · ')}
              {comparison.shortenedBy?.length
                ? ` · window shortened by ${comparison.shortenedBy
                    .map((s) => `${s.symbol} (${s.sessions} sessions)`)
                    .join(', ')}`
                : ''}
            </Alert>
          ) : null}
          {comparison && comparison.series.length >= 2 ? (
            <TableContainer sx={{ mt: 2 }}>
              <Table
                size="small"
                aria-label="Normalised comparison statistics"
                /* Four right-aligned figures in a 332px card: the default 16px cell padding pushed
                   the drawdown column off the edge, so the padding tightens and the two long
                   headers are allowed to wrap instead of setting the table's width. */
                sx={{ '& th, & td': { px: { xs: 0.75, sm: 2 } }, '& th': { whiteSpace: 'normal' } }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Symbol</TableCell>
                    <TableCell align="right">Return</TableCell>
                    <TableCell align="right">Volatility (ann.)</TableCell>
                    <TableCell align="right">Max drawdown</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {comparison.series.map((s) => (
                    <TableRow key={s.symbol}>
                      <TableCell>{s.symbol}</TableCell>
                      <TableCell align="right">
                        <ChangePill value={s.returnPct} size="sm" />
                      </TableCell>
                      <TableCell align="right">{formatNumber(s.volatilityPct, { maximumFractionDigits: 1 })}%</TableCell>
                      <TableCell align="right">−{formatNumber(s.maxDrawdownPct, { maximumFractionDigits: 1 })}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : null}
        </SectionCard>
      ) : null}

      {symbols.length === 0 ? (
        <StatePanel
          kind="empty"
          title="Nothing to compare yet"
          description="Add at least two symbols above to see them side by side."
        />
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Stock comparison" sx={{ minWidth: 640 }}>
            <TableHead>
              <TableRow>
                <TableCell />
                {symbols.map((sym) => (
                  <TableCell key={sym} align="right">
                    <Typography
                      component={RouterLink}
                      to={`/stocks/${sym}`}
                      variant="subtitle2"
                      sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                    >
                      {sym}
                    </Typography>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody sx={isLoading ? { opacity: 0.55 } : undefined}>
              {METRICS.map((m) => (
                <TableRow key={m.label} hover>
                  <TableCell component="th" scope="row" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {m.label}
                  </TableCell>
                  {symbols.map((sym) => {
                    const stock = rows.find((s) => s.symbol === sym);
                    return (
                      <TableCell key={sym} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {stock ? m.render(stock) : DASH}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
