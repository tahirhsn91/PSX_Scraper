import { useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
 * One line item's value, formatted to its unit. The source encodes the unit in the display name —
 * "(%)" is a percentage, "(x)" a ratio — and everything else is money in PKR millions, so a money
 * row is comma-grouped as a whole number (matching the reference layout) and EPS stays a per-share
 * figure with two decimals.
 */
function formatLineValue(name: string, value: number | null): string {
  if (value === null) return DASH;
  const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (name.endsWith('(%)')) return `${formatNumber(value, two)}%`;
  if (name.endsWith('(x)')) return `${formatNumber(value, two)}x`;
  if (name === 'Basic EPS' || name === 'Diluted EPS') return formatNumber(value, two);
  return formatNumber(value, { maximumFractionDigits: 0 });
}

/**
 * The income-statement view: line items down the left, "TTM" + fiscal years across the top, in the
 * source's own order. A bank's rows differ from an industrial's, so whatever lines the source
 * published for this security are rendered as they came. The first column is sticky so the line
 * names stay visible while a phone scrolls the years sideways.
 */
export function IncomeStatementPanel({ statement }: { statement: Statement | null }) {
  // TTM + the latest fiscal year is the readable default; older years are one toggle away. With
  // five columns open the card measured 832px and most of the far columns were empty dashes.
  const [showAllPeriods, setShowAllPeriods] = useState(false);
  // The statement is 23 rows at HBL (and longer for industrials). Two headline figures tell most
  // readers what they came for; the full table opens on demand.
  const [showStatement, setShowStatement] = useState(false);
  if (!statement || statement.lines.length === 0) {
    return (
      <SectionCard
        title="Financials"
        subtitle="Income statement · values in PKR millions"
      >
        <StatePanel
          kind="empty"
          compact
          title="No income statement recorded"
          description="Sync the company page to pick up the full income statement."
        />
      </SectionCard>
    );
  }

  const { periods, lines } = statement;
  const visiblePeriods = showAllPeriods ? periods : periods.slice(0, 2);
  const summaryRows = ['Net Income', 'Basic EPS'].flatMap((name) => {
    const line = lines.find((l) => l.metricName === name);
    return line ? [line] : [];
  });

  return (
    <SectionCard
      title="Financials"
      subtitle="Income statement · values in PKR millions"
      flush
    >
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
                  {p}
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
                    <TableCell
                      key={p}
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
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </TableContainer>
      </Collapse>
      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          alignItems: 'flex-start',
        }}
      >
        {!showStatement && summaryRows.length > 0 && (
          <Stack spacing={0.5} sx={{ width: '100%', mb: 0.5 }}>
            {summaryRows.map((line) => (
              <Box
                key={line.metricName}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  columnGap: 2,
                  rowGap: 0.25,
                  alignItems: 'baseline',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 92 }}>
                  {line.metricName}
                </Typography>
                {periods.slice(0, 2).map((p) => (
                  <Typography key={p} variant="body2" color="text.secondary">
                    {p}{' '}
                    <Box
                      component="span"
                      sx={{
                        color: 'text.primary',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatLineValue(line.metricName, line.values[p] ?? null)}
                    </Box>
                  </Typography>
                ))}
              </Box>
            ))}
          </Stack>
        )}
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button
            size="small"
            onClick={() => setShowStatement((v) => !v)}
            aria-expanded={showStatement}
            sx={{ minHeight: 32 }}
          >
            {showStatement ? 'Hide full statement' : `Show full statement (${lines.length} lines)`}
          </Button>
          {showStatement && periods.length > 2 && (
            <Button
              size="small"
              onClick={() => setShowAllPeriods((v) => !v)}
              aria-expanded={showAllPeriods}
              sx={{ minHeight: 32 }}
            >
              {showAllPeriods ? 'Show fewer periods' : `Show all ${periods.length} periods`}
            </Button>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Blank means the source published no figure for that period — older years are often empty.
        </Typography>
      </Box>
    </SectionCard>
  );
}
