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
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useStocks } from '../api/hooks';
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
export function Compare() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  const { data, isLoading } = useStocks(
    1,
    MAX,
    false,
    undefined,
    'asc',
    undefined,
    undefined,
    symbols.length > 0 ? { symbols } : undefined,
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
