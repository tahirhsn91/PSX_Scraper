import { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CalculateRoundedIcon from '@mui/icons-material/CalculateRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatePanel } from '../components/ui/StatePanel';
import { useRoi, useSearch } from '../api/hooks';
import type { RoiMode, RoiParams, RoiPoint, RoiResponse, RoiRow } from '../types/roi';

/**
 * ROI calculator.
 *
 * The page is deliberately a form first and a result second: nothing is computed until the reader
 * presses Calculate, so a half-typed symbol never fires a request and the numbers on screen always
 * belong to the inputs above them. Every figure shown comes from the API — this file formats, it does
 * not model.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

function oneYearAgo(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return iso(d);
}

const money = (n: number | null | undefined): string =>
  n == null ? '—' : `Rs ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (n: number | null | undefined): string =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const prettyDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** A compact symbol field: type two letters, pick a company, and the ticker is what the API gets. */
function SymbolField({
  value,
  onChange,
  label,
  size,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  size?: 'small' | 'medium';
}) {
  const [input, setInput] = useState('');
  const { data } = useSearch(input.trim().length >= 1 ? input : '');
  const options = data?.results?.slice(0, 12) ?? [];

  return (
    <Autocomplete
      freeSolo
      size={size}
      options={options.map((o) => o.symbol)}
      value={value}
      inputValue={input}
      onInputChange={(_, v) => {
        setInput(v.toUpperCase());
        if (!v) onChange('');
      }}
      onChange={(_, v) => onChange((v ?? '').toString().toUpperCase())}
      filterOptions={(x) => x}
      renderOption={(props, option) => {
        const row = options.find((o) => o.symbol === option);
        return (
          <Box component="li" {...props} key={option} sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
            <Typography sx={{ fontWeight: 700, minWidth: 64 }}>{option}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {row?.companyName ?? ''}
            </Typography>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder="e.g. FFC" inputProps={{ ...params.inputProps, style: { textTransform: 'uppercase' } }} />
      )}
      sx={{ minWidth: 220, flex: 1 }}
    />
  );
}

/** Position value over the window, drawn the same way the compare page draws its lines. */
function EquityChart({ points, label }: { points: RoiPoint[]; label: string }) {
  const theme = useTheme();
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 100 - ((p.value - min) / span) * 100;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const up = values[values.length - 1]! >= values[0]!;

  return (
    <Box>
      <Box
        component="svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        width="100%"
        height={220}
        role="img"
        aria-label={label}
        sx={{ display: 'block', overflow: 'visible' }}
      >
        <path d={`${path} L100,100 L0,100 Z`} fill={up ? theme.palette.chart.up : theme.palette.chart.down} opacity={0.08} />
        {/* The starting value as a reference line: a rise looks the same whether the scale starts at
            the entry price or at zero, and this is the line that says which. */}
        <line
          x1={0}
          x2={100}
          y1={100 - ((values[0]! - min) / span) * 100}
          y2={100 - ((values[0]! - min) / span) * 100}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          opacity={0.35}
        />
        <path d={path} fill="none" stroke={up ? theme.palette.chart.up : theme.palette.chart.down} strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {prettyDate(points[0]!.date)} · Rs {Math.round(points[0]!.value).toLocaleString('en-PK')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Rs {Math.round(points[points.length - 1]!.value).toLocaleString('en-PK')} · {prettyDate(points[points.length - 1]!.date)}
        </Typography>
      </Stack>
    </Box>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'up' | 'down' }) {
  const theme = useTheme();
  const colour = tone === 'up' ? theme.palette.chart.up : tone === 'down' ? theme.palette.chart.down : 'text.primary';
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: { xs: '1.35rem', sm: '1.6rem' }, fontWeight: 750, lineHeight: 1.15, color: colour, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </Box>
  );
}

function RowTable({ rows }: { rows: { label: string; value: string; strong?: boolean }[] }) {
  return (
    <Box component="dl" sx={{ m: 0, '& > div': { display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.9, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } } }}>
      {rows.map((r) => (
        <Box key={r.label}>
          <Typography component="dt" variant="body2" color="text.secondary">{r.label}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: r.strong ? 700 : 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {r.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function BenchmarkLine({ row }: { row: RoiRow | null }) {
  if (!row) return null;
  const theme = useTheme();
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.5} sx={{ pt: 1.5 }}>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name ?? row.symbol}</Typography>
        {row.note && <Typography variant="caption" color="text.secondary">{row.note}</Typography>}
      </Box>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Chip size="small" label={pct(row.returnPct)} sx={{ fontWeight: 700, color: row.returnPct >= 0 ? theme.palette.chart.up : theme.palette.chart.down, bgcolor: 'action.hover' }} />
        {row.annualisedPct != null && <Typography variant="caption" color="text.secondary">{pct(row.annualisedPct)} a year</Typography>}
      </Stack>
    </Stack>
  );
}

export default function RoiCalculator() {
  const theme = useTheme();
  const [mode, setMode] = useState<RoiMode>('single');
  const [symbol, setSymbol] = useState('FFC');
  const [compareSymbols, setCompareSymbols] = useState<string[]>(['FFC', 'HBL', 'MEBL']);
  const [start, setStart] = useState(oneYearAgo());
  const [end, setEnd] = useState('');
  const [amount, setAmount] = useState('100000');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [feePct, setFeePct] = useState('0.15');
  const [feeFlat, setFeeFlat] = useState('0');
  const [divTax, setDivTax] = useState('0');
  const [cgt, setCgt] = useState('0');
  const [submitted, setSubmitted] = useState<RoiParams | null>(null);

  const amountNum = Number(amount);
  const valid =
    start.length === 10 &&
    amountNum >= 100 &&
    (mode === 'compare'
      ? compareSymbols.filter(Boolean).length >= 2
      : symbol.trim().length >= 1);

  const { data, isFetching, error, refetch } = useRoi(submitted);

  const submit = () => {
    if (!valid) return;
    setSubmitted({
      mode,
      symbol: mode === 'compare' ? undefined : symbol.trim().toUpperCase(),
      symbols: mode === 'compare' ? compareSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined,
      start,
      end: end || undefined,
      amount: amountNum,
      dayOfMonth: mode === 'dca' ? Number(dayOfMonth) : undefined,
      feePct: Number(feePct) || 0,
      feeFlat: Number(feeFlat) || 0,
      divTax: Number(divTax) || 0,
      cgt: Number(cgt) || 0,
    });
  };

  const errorMessage = useMemo(() => {
    const e = error as { response?: { data?: { error?: { message?: string } } } } | null;
    return e?.response?.data?.error?.message ?? (error ? 'The calculation could not be completed.' : null);
  }, [error]);

  const result: RoiResponse | undefined = data;

  return (
    <Box>
      <PageHeader
        title="ROI Calculator"
        subtitle="What a holding, a monthly plan or a shortlist actually returned — on stored closing prices, with your fees and taxes."
      />

      <SectionCard title="Inputs" subtitle="Every assumption is yours to set; nothing here is an official PSX or broker rate.">
        <Tabs value={mode} onChange={(_, v: RoiMode) => { setMode(v); setSubmitted(null); }} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }}>
          <Tab value="single" label="Single holding" />
          <Tab value="dca" label="Monthly plan" />
          <Tab value="compare" label="Compare" />
        </Tabs>

        <Stack spacing={2}>
          {mode === 'compare' ? (
            <Stack spacing={1}>
              {compareSymbols.map((s, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <SymbolField
                    label={`Symbol ${i + 1}`}
                    value={s}
                    size="small"
                    onChange={(v) => setCompareSymbols((prev) => prev.map((x, j) => (j === i ? v : x)))}
                  />
                  {compareSymbols.length > 2 && (
                    <Button
                      size="small"
                      aria-label={`Remove symbol ${i + 1}`}
                      onClick={() => setCompareSymbols((prev) => prev.filter((_, j) => j !== i))}
                      sx={{ minWidth: 40 }}
                    >
                      <CloseRoundedIcon fontSize="small" />
                    </Button>
                  )}
                </Stack>
              ))}
              {compareSymbols.length < 4 && (
                <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setCompareSymbols((p) => [...p, ''])} sx={{ alignSelf: 'flex-start' }}>
                  Add symbol
                </Button>
              )}
            </Stack>
          ) : (
            <SymbolField label="Symbol" value={symbol} onChange={setSymbol} />
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={mode === 'dca' ? 'First month' : mode === 'compare' ? 'Start date' : 'Buy date'}
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              fullWidth
            />
            <TextField
              label={mode === 'compare' ? 'End date' : 'Sell date'}
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              helperText="Blank = latest stored session"
              fullWidth
            />
            <TextField
              label={mode === 'dca' ? 'Monthly amount (Rs)' : 'Amount (Rs)'}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              size="small"
              inputProps={{ min: 100, step: 1000 }}
              fullWidth
            />
            {mode === 'dca' && (
              <TextField
                label="Day of month"
                type="number"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                size="small"
                inputProps={{ min: 1, max: 31 }}
                helperText="Moved to the next session"
                fullWidth
              />
            )}
          </Stack>

          <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Fees and taxes · {feePct || 0}% + Rs {feeFlat || 0} per side
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Fee % per side" type="number" value={feePct} onChange={(e) => setFeePct(e.target.value)} size="small" inputProps={{ min: 0, max: 5, step: 0.01 }} fullWidth />
                <TextField label="Flat fee per side (Rs)" type="number" value={feeFlat} onChange={(e) => setFeeFlat(e.target.value)} size="small" inputProps={{ min: 0, step: 10 }} fullWidth />
                <TextField label="Dividend tax %" type="number" value={divTax} onChange={(e) => setDivTax(e.target.value)} size="small" inputProps={{ min: 0, max: 50, step: 1 }} fullWidth />
                <TextField label="Capital gains tax %" type="number" value={cgt} onChange={(e) => setCgt(e.target.value)} size="small" inputProps={{ min: 0, max: 50, step: 1 }} fullWidth />
              </Stack>
            </AccordionDetails>
          </Accordion>

          <Stack direction="row" spacing={1} alignItems="center">
            <Button variant="contained" startIcon={<CalculateRoundedIcon />} onClick={submit} disabled={!valid || isFetching}>
              Calculate
            </Button>
            {isFetching && <CircularProgress size={18} />}
            {submitted && !isFetching && <Button size="small" onClick={() => refetch()}>Refresh</Button>}
          </Stack>
        </Stack>
      </SectionCard>

      {errorMessage && (
        <Box sx={{ mt: 2 }}>
          <StatePanel kind="error" title="That calculation did not run" description={errorMessage} />
        </Box>
      )}

      {!submitted && !errorMessage && (
        <Box sx={{ mt: 2 }}>
          <StatePanel
            kind="empty"
            title="Nothing calculated yet"
            description="Pick a symbol and a window, then press Calculate. The result will show the position, the fees, the dividends recorded in our data and the return net of both."
          />
        </Box>
      )}

      {isFetching && !result && <Box sx={{ mt: 2 }}><StatePanel kind="loading" title="Calculating…" /></Box>}

      {result?.holding && (
        <Stack spacing={2} sx={{ mt: 2 }}>
          <SectionCard
            title={`${result.holding.symbol}${result.holding.name ? ` · ${result.holding.name}` : ''}`}
            subtitle={`${prettyDate(result.holding.buy.session)} → ${prettyDate(result.holding.sell.session)} · ${result.holding.holdingDays} days · ${result.holding.sessions} sessions`}
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, minmax(0, auto))' }, gap: 2, justifyContent: 'start', mb: 2 }}>
              <Stat label="TOTAL RETURN" value={pct(result.holding.returnPct)} tone={result.holding.returnPct >= 0 ? 'up' : 'down'} hint={money(result.holding.profit)} />
              <Stat label="ANNUALISED (XIRR)" value={result.holding.annualisedPct == null ? '—' : pct(result.holding.annualisedPct)} hint={result.holding.annualisedPct == null ? 'Not shown under a year or across a split' : 'Money-weighted, actual/365'} />
              <Stat label="MAX DRAWDOWN" value={`${result.holding.maxDrawdownPct.toFixed(2)}%`} hint="Peak to trough, position value, excludes dividends" />
            </Box>

            <EquityChart points={result.holding.series} label={`Position value of ${result.holding.symbol} from ${result.holding.buy.session} to ${result.holding.sell.session}`} />
            <Divider sx={{ my: 2 }} />
            <RowTable
              rows={[
                { label: `Shares bought at ${money(result.holding.buy.price)}`, value: String(result.holding.quantity) },
                { label: 'Cash deployed (incl. buy fee)', value: money(result.holding.invested), strong: true },
                { label: 'Leftover cash', value: money(result.holding.leftover) },
                { label: 'Buy fee', value: money(result.holding.buyFees) },
                { label: `Dividends (${result.holding.dividends.count} recorded)`, value: money(result.holding.dividends.net) },
                { label: `Sold at ${money(result.holding.sell.price)} · fee ${money(result.holding.proceeds.sellFees)}`, value: money(result.holding.proceeds.net) },
                { label: 'Profit', value: money(result.holding.profit), strong: true },
              ]}
            />
            {result.benchmark && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <BenchmarkLine row={result.benchmark} />
              </>
            )}
          </SectionCard>
        </Stack>
      )}

      {result?.dca && (
        <Stack spacing={2} sx={{ mt: 2 }}>
          <SectionCard
            title={`${result.dca.symbol} · ${result.dca.months} monthly buys`}
            subtitle={`${prettyDate(result.meta.window.start)} → ${prettyDate(result.dca.sell.session)} · ${prettyDate(result.dca.sell.session)} at ${money(result.dca.sell.price)}`}
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, minmax(0, auto))' }, gap: 2, justifyContent: 'start', mb: 2 }}>
              <Stat label="TOTAL RETURN" value={pct(result.dca.returnPct)} tone={result.dca.returnPct >= 0 ? 'up' : 'down'} hint={money(result.dca.profit)} />
              <Stat label="ANNUALISED (XIRR)" value={result.dca.annualisedPct == null ? '—' : pct(result.dca.annualisedPct)} hint={result.dca.annualisedPct == null ? 'Not shown under a year' : 'Money-weighted, actual/365'} />
              <Stat label="INVESTED" value={money(result.dca.totalInvested)} hint={`avg cost ${money(result.dca.averageCost)}`} />
              <Stat label="MAX DRAWDOWN" value={`${result.dca.maxDrawdownPct.toFixed(2)}%`} hint="Price drawdown, contribution-neutral" />
            </Box>

            <EquityChart points={result.dca.series} label={`Monthly plan value for ${result.dca.symbol}`} />
            <Divider sx={{ my: 2 }} />
            <RowTable
              rows={[
                { label: 'Months bought', value: String(result.dca.months) },
                { label: 'Shares held', value: String(result.dca.quantity) },
                { label: 'Dividends recorded', value: money(result.dca.dividends.net) },
                { label: 'Value at sale (net of fee)', value: money(result.dca.terminalValue) },
                { label: 'Lump sum of the same cash, same window', value: `${pct(result.dca.lumpSum.returnPct)} · ${money(result.dca.lumpSum.terminalValue)}`, strong: true },
              ]}
            />
            {result.dca.benchmark && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <BenchmarkLine row={result.dca.benchmark} />
              </>
            )}
          </SectionCard>
        </Stack>
      )}

      {result?.compare && (
        <SectionCard
          title="Comparison"
          subtitle={`${prettyDate(result.compare.start)} → ${prettyDate(result.compare.end)} · same cash, same window, one close per session`}
          sx={{ mt: 2 }}
        >
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'right', py: 1, px: { xs: 0.75, sm: 1.5 }, borderBottom: '1px solid', borderColor: 'divider' }, '& th:first-of-type, & td:first-of-type': { textAlign: 'left' } }}>
            <thead>
              <tr>
                <th><Typography variant="caption" color="text.secondary">SYMBOL</Typography></th>
                <th><Typography variant="caption" color="text.secondary">RETURN</Typography></th>
                <th><Typography variant="caption" color="text.secondary">ANNUALISED</Typography></th>
                <th><Typography variant="caption" color="text.secondary">MAX DD</Typography></th>
                <th><Typography variant="caption" color="text.secondary">VALUE</Typography></th>
              </tr>
            </thead>
            <tbody>
              {result.compare.rows.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.symbol}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{r.name}</Typography>
                  </td>
                  <td><Typography variant="body2" sx={{ fontWeight: 700, color: r.returnPct >= 0 ? theme.palette.chart.up : theme.palette.chart.down }}>{pct(r.returnPct)}</Typography></td>
                  <td><Typography variant="body2">{r.annualisedPct == null ? '—' : pct(r.annualisedPct)}</Typography></td>
                  <td><Typography variant="body2">{r.maxDrawdownPct == null ? '—' : `${r.maxDrawdownPct.toFixed(1)}%`}</Typography></td>
                  <td><Typography variant="body2">{money(r.terminalValue)}</Typography></td>
                </tr>
              ))}
              {result.benchmark && (
                <tr>
                  <td><Typography variant="body2" sx={{ fontWeight: 600 }}>KSE-100</Typography><Typography variant="caption" color="text.secondary">total return</Typography></td>
                  <td><Typography variant="body2" sx={{ fontWeight: 600 }}>{pct(result.benchmark.returnPct)}</Typography></td>
                  <td><Typography variant="body2">{result.benchmark.annualisedPct == null ? '—' : pct(result.benchmark.annualisedPct)}</Typography></td>
                  <td><Typography variant="body2">{result.benchmark.maxDrawdownPct == null ? '—' : `${result.benchmark.maxDrawdownPct.toFixed(1)}%`}</Typography></td>
                  <td><Typography variant="body2">{money(result.benchmark.terminalValue)}</Typography></td>
                </tr>
              )}
            </tbody>
          </Box>
          {result.compare.excluded.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Excluded: {result.compare.excluded.map((e) => `${e.symbol} (${e.reason})`).join('; ')}
            </Typography>
          )}
        </SectionCard>
      )}

      {result && (
        <Stack spacing={1} sx={{ mt: 2 }}>
          {result.meta.warnings.map((w, i) => (
            <Alert
              key={`${w.code}-${i}`}
              severity={w.code === 'CORPORATE_ACTION_SUSPECTED' ? 'warning' : 'info'}
              variant="outlined"
              sx={{ '& .MuiAlert-message': { fontSize: '0.8125rem' } }}
            >
              {w.message}
              {w.date ? ` (${prettyDate(w.date)})` : ''}
            </Alert>
          ))}
          <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Assumptions behind these numbers</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 2.5 }}>
                {result.meta.assumptions.map((a) => (
                  <Typography component="li" variant="caption" color="text.secondary" key={a}>{a}</Typography>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                Latest completed session in this database: {prettyDate(result.meta.latestSession)}. Not investment advice.
              </Typography>
            </AccordionDetails>
          </Accordion>
        </Stack>
      )}
    </Box>
  );
}
