import { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Collapse,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { DASH, formatNumber } from '../lib/format';
import { SectionCard } from './ui/SectionCard';
import { StatePanel } from './ui/StatePanel';
import type { StockDetail } from '../types';

type Statement = NonNullable<StockDetail['incomeStatement']>;

/** Rows the source prints as subtotals/totals, emphasised so the statement reads like an account. */
const EMPHASIS = new Set([
  'Gross Profit',
  'Operating Profit (EBIT)',
  'EBITDA',
  'Profit before Taxation',
  'Net Income',
]);

/**
 * The one provider that publishes these rows. Only Sarmaaya's fundamentals API writes income
 * statements (PSX's company page carries none), so citing it per cell is a statement of fact rather
 * than a guess — the alternative would be a `source` column holding the same string 14,322 times.
 */
const SOURCE = 'Sarmaaya income-statement API';

/**
 * One line item's value, formatted to its unit. The source encodes the unit in the display name —
 * "(%)" is a percentage, "(x)" a ratio — and everything else is money in PKR millions, so a money
 * row is comma-grouped as a whole number and EPS stays a per-share figure with two decimals.
 */
function formatLineValue(name: string, value: number | null): string {
  if (value === null) return DASH;
  const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (name.endsWith('(%)')) return `${formatNumber(value, two)}%`;
  if (name.endsWith('(x)')) return `${formatNumber(value, two)}x`;
  if (name === 'Basic EPS' || name === 'Diluted EPS') return formatNumber(value, two);
  return formatNumber(value, { maximumFractionDigits: 0 });
}

/** "TTM" is trailing twelve months; everything else is a fiscal year. The two are never mixed. */
const isTtm = (period: string) => period.toUpperCase() === 'TTM';

/** Bars for one annual series, scaled to its own range and labelled with the periods they cover. */
function TrendBars({
  title,
  points,
  suffix = '',
}: {
  title: string;
  points: { period: string; value: number }[];
  suffix?: string;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => Math.abs(p.value)));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const h = 72;
  const w = 100;
  const bw = w / points.length;
  const y = (v: number) => h - ((v - min) / span) * h;
  const zero = y(0);
  const latest = points[points.length - 1].value;
  return (
    <Box sx={{ flex: 1, minWidth: 170 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {title}
      </Typography>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden="true">
        <line x1={0} x2={w} y1={zero} y2={zero} stroke="currentColor" strokeOpacity={0.25} />
        {points.map((p, i) => (
          <rect
            key={p.period}
            x={i * bw + bw * 0.15}
            y={p.value >= 0 ? y(p.value) : zero}
            width={bw * 0.7}
            height={Math.abs(y(p.value) - zero)}
            fill="currentColor"
            opacity={0.75}
          />
        ))}
      </svg>
      <Box sx={{ display: 'flex', justifyContent: 'space-around' }}>
        {points.map((p) => (
          <Typography key={p.period} variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
            {p.period}
          </Typography>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" display="block">
        latest {formatNumber(latest, { maximumFractionDigits: 0 })}
        {suffix}
      </Typography>
    </Box>
  );
}

/**
 * The income statement: line items down the left, the periods the source actually published across
 * the top, in its own order.
 *
 * Only annual periods and TTM exist — the source publishes no quarterly statements — so the control
 * offers a chip per period that is present, not a period-*type* selector that could promise quarters
 * we cannot draw. A chip toggles that whole column, so no figure is ever a mix of an annual column
 * and the trailing-twelve-month one.
 */
export function IncomeStatementPanel({ statement }: { statement: Statement | null }) {
  const lines = statement?.lines ?? [];
  const periods = statement?.periods ?? [];

  // Default: TTM plus the two most recent fiscal years — enough to show a trend without turning the
  // card into a wall of mostly-empty dashes.
  const [selected, setSelected] = useState<string[]>(() => [
    ...periods.filter(isTtm),
    ...periods.filter((p) => !isTtm(p)).slice(0, 2),
  ]);
  const [showStatement, setShowStatement] = useState(false);

  const toggle = (period: string) =>
    setSelected((s) => (s.includes(period) ? s.filter((p) => p !== period) : [...s, period]));

  const visiblePeriods = useMemo(() => periods.filter((p) => selected.includes(p)), [periods, selected]);

  if (!statement || lines.length === 0) {
    return (
      <SectionCard title="Financials" subtitle="Income statement">
        <StatePanel
          kind="empty"
          compact
          title="No income statement recorded"
          description={`No statement has been ingested for this symbol. ${SOURCE} is the only provider that publishes one, so a symbol it does not cover shows this message rather than a table of zeros.`}
        />
      </SectionCard>
    );
  }

  const annual = periods.filter((p) => !isTtm(p)).slice().sort();
  const series = (name: string) => {
    const line = lines.find((l) => l.metricName === name);
    if (!line) return [];
    return annual
      .map((p) => ({ period: p, value: line.values[p] }))
      .filter((p): p is { period: string; value: number } => p.value != null);
  };

  const netIncome = series('Net Income');
  // Banks publish "Net Interest Income" where an industrial publishes "Revenue"; take the first
  // top-line label this statement actually carries rather than drawing an empty chart for banks.
  const revenueName = ['Revenue', 'Net Sales', 'Sales', 'Net Interest Income'].find((n) =>
    lines.some((l) => l.metricName === n),
  );
  const revenue = revenueName ? series(revenueName) : [];
  const eps = series('Basic EPS');
  const hasTrend = netIncome.length >= 2 || revenue.length >= 2 || eps.length >= 2;

  return (
    <SectionCard
      title="Financials"
      subtitle="Income statement · PKR millions unless the row says otherwise"
      flush
    >
      <Box sx={{ px: 2, pt: 1.5 }}>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
          {periods.map((p) => (
            <Chip
              key={p}
              size="small"
              label={isTtm(p) ? 'TTM (trailing 12 months)' : `FY ${p}`}
              color={selected.includes(p) ? 'primary' : 'default'}
              variant={selected.includes(p) ? 'filled' : 'outlined'}
              onClick={() => toggle(p)}
              title={isTtm(p) ? 'Trailing twelve months — not a fiscal year' : `Fiscal year ${p}`}
            />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: hasTrend ? 1.5 : 1 }}>
          {periods.some(isTtm) ? 'Annual statements plus a trailing-twelve-month reading. ' : 'Annual statements. '}
          The source publishes no quarterly periods and no publication date, so neither is offered
          here — an empty date column would read as a missing value rather than an unpublished one.
          Source: {SOURCE}.
        </Typography>

        {!hasTrend && annual.length >= 2 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Trends need at least two annual periods for a line. This statement carries {annual.length} fiscal
            years but the provider returned a value for only one of them on most lines — the chart is
            left out rather than drawn from a single point.
          </Typography>
        ) : null}
        {hasTrend ? (
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" sx={{ mb: 2, color: 'text.primary' }}>
            <TrendBars title="Net income (annual)" points={netIncome} />
            <TrendBars title={`${revenueName ?? 'Revenue'} (annual)`} points={revenue} />
            <TrendBars title="Basic EPS (annual)" points={eps} suffix=" / share" />
          </Stack>
        ) : null}
      </Box>

      <Box sx={{ px: 2, pb: 1 }}>
        {visiblePeriods.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No period selected — choose one above to see the statement.
          </Typography>
        ) : (
          <Typography
            component="button"
            type="button"
            onClick={() => setShowStatement((v) => !v)}
            aria-expanded={showStatement}
            sx={{
              background: 'none',
              border: 0,
              p: 0,
              color: 'primary.main',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '0.8125rem',
            }}
          >
            {showStatement ? 'Hide the full statement' : `Show the full statement (${lines.length} rows)`}
          </Typography>
        )}
      </Box>

      <Collapse in={showStatement} unmountOnExit>
        <TableContainer>
          <Table size="small" aria-label="Income statement">
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    bgcolor: 'background.paper',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                    PKR&nbsp;(M)
                  </Box>
                </TableCell>
                {visiblePeriods.map((p) => (
                  <TableCell key={p} align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <Tooltip title={isTtm(p) ? 'Trailing twelve months' : `Fiscal year ${p}`}>
                      <span>{isTtm(p) ? 'TTM' : p}</span>
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line) => {
                const emphasised = EMPHASIS.has(line.metricName);
                const isNetIncome = line.metricName === 'Net Income';
                return (
                  <TableRow key={line.metricCode || line.metricName} hover>
                    <TableCell
                      component="th"
                      scope="row"
                      sx={{
                        position: 'sticky',
                        left: 0,
                        zIndex: 1,
                        bgcolor: 'background.paper',
                        fontWeight: emphasised ? 700 : 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {line.metricName}
                    </TableCell>
                    {visiblePeriods.map((p) => (
                      <Tooltip
                        key={p}
                        title={`${line.metricName} · ${isTtm(p) ? 'TTM' : `FY ${p}`} · ${SOURCE}`}
                      >
                        <TableCell
                          align="right"
                          sx={{
                            fontWeight: emphasised ? 700 : 400,
                            whiteSpace: 'nowrap',
                            borderTop: isNetIncome ? 2 : undefined,
                            borderTopColor: isNetIncome ? 'divider' : undefined,
                          }}
                        >
                          {formatLineValue(line.metricName, line.values[p] ?? null)}
                        </TableCell>
                      </Tooltip>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
        Blank means the source published no figure for that period — older years are often empty.
      </Typography>
    </SectionCard>
  );
}
