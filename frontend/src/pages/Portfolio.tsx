import { useMemo } from 'react';
import { Button, Grid, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useStocks } from '../api/hooks';
import { useHoldings } from '../lib/holdings';
import { buildRows, summarise, type HoldingRow, type Quote } from '../lib/portfolio';
import { ChangePill } from '../components/ui/ChangePill';
import { DataTable, type Column } from '../components/ui/DataTable';
import { HoldingButton } from '../components/HoldingDialog';
import { PortfolioComposition } from '../components/PortfolioComposition';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatTile, type StatTone } from '../components/ui/StatTile';
import { StatePanel } from '../components/ui/StatePanel';
import { DASH, formatNumber, formatPercent, formatRupees, trendOf } from '../lib/format';

/**
 * The list endpoint validates `limit` as at most 200, and every position on this page has to be
 * priced in one request — hence a ceiling on how many holdings can be valued at once.
 */
const MAX_POSITIONS = 200;

/** `+Rs 5,000` / `-Rs 1,200` / the dash. Rupees, so the sign is spelled out rather than a glyph. */
const signedRupees = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return DASH;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatRupees(Math.abs(value))}`;
};

const toneOf = (value: number | null | undefined): StatTone => {
  const trend = trendOf(value);
  return trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'neutral';
};

/**
 * The portfolio view.
 *
 * Positions live on the device (`lib/holdings.ts`) and the prices are the same list rows the
 * dashboard and the watchlist read — one `symbols`-filtered request rather than one detail request
 * per holding. Every figure is derived in `lib/portfolio.ts`, so the arithmetic is the same code the
 * numbers are checked against.
 */
export function Portfolio() {
  const { holdings, clear } = useHoldings();
  const symbols = holdings.map((h) => h.symbol);
  const limit = Math.min(Math.max(symbols.length, 1), MAX_POSITIONS);
  const { data, isLoading, error, refetch } = useStocks(
    1,
    limit,
    false,
    'symbol',
    'asc',
    undefined,
    undefined,
    symbols.length > 0 ? { symbols } : undefined,
  );

  // The rows come back in the order the ids were asked for, so index them by symbol and let
  // `buildRows` decide what a missing quote means.
  const quotes = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const item of data?.items ?? []) {
      map.set(item.symbol.toUpperCase(), {
        symbol: item.symbol,
        companyName: item.companyName,
        currentPrice: item.currentPrice,
        changePercent: item.changePercent,
      });
    }
    return map;
  }, [data]);

  const rows = useMemo(() => buildRows(holdings, quotes), [holdings, quotes]);
  const totals = useMemo(() => summarise(rows), [rows]);

  const columns: Column<HoldingRow>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      render: (r) => r.symbol,
      mobileRole: 'title',
    },
    {
      key: 'company',
      header: 'Company',
      render: (r) => r.companyName ?? DASH,
      noWrap: true,
      hideBelow: 'md',
      mobileRole: 'subtitle',
    },
    {
      key: 'quantity',
      header: 'Qty',
      align: 'right',
      render: (r) => formatNumber(r.quantity, { maximumFractionDigits: 4 }),
      mobileRole: 'meta',
    },
    {
      key: 'avgBuyPrice',
      header: 'Avg buy',
      align: 'right',
      render: (r) => formatNumber(r.avgBuyPrice),
      hideBelow: 'sm',
      mobileRole: 'meta',
    },
    {
      key: 'currentPrice',
      header: 'Price',
      align: 'right',
      render: (r) => formatNumber(r.currentPrice),
      mobileRole: 'meta',
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (r) => (r.value == null ? DASH : formatRupees(r.value)),
      mobileRole: 'meta',
    },
    {
      key: 'pl',
      header: 'P&L',
      align: 'right',
      mobileRole: 'value',
      render: (r) =>
        r.pl == null ? (
          DASH
        ) : (
          <Stack direction="row" spacing={0.5} alignItems="baseline" justifyContent="flex-end">
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: r.pl > 0 ? 'up.main' : r.pl < 0 ? 'down.main' : 'text.secondary',
              }}
            >
              {signedRupees(r.pl)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatPercent(r.plPercent)}
            </Typography>
          </Stack>
        ),
    },
    {
      key: 'day',
      header: 'Day',
      align: 'right',
      render: (r) => <ChangePill value={r.dayChangePercent} variant="soft" />,
      mobileRole: 'meta',
    },
    {
      key: 'allocation',
      header: 'Alloc',
      align: 'right',
      render: (r) => (r.allocationPercent == null ? DASH : formatPercent(r.allocationPercent, 1)),
      hideBelow: 'md',
    },
    {
      key: 'holding',
      header: '',
      align: 'right',
      width: 88,
      render: (r) => <HoldingButton symbol={r.symbol} compact />,
    },
  ];

  const unpriced = totals.holdings - totals.priced;

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle="Your positions on this device, valued at the latest price"
        actions={
          totals.holdings > 0 ? (
            <Button variant="outlined" size="small" onClick={clear}>
              Clear portfolio
            </Button>
          ) : undefined
        }
      />

      {totals.holdings > 0 && (
        <Grid container spacing={1.5} sx={{ mb: 3 }}>
          <Grid item xs={6} md={3}>
            <StatTile
              label="Invested"
              value={formatRupees(totals.invested)}
              footer={
                <Typography variant="caption" color="text.secondary">
                  {totals.holdings === 1 ? '1 position' : `${totals.holdings} positions`}
                </Typography>
              }
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile
              label="Current value"
              value={formatRupees(totals.value)}
              valueTitle={`Rs ${totals.value.toFixed(2)}`}
              footer={
                <Typography variant="caption" color="text.secondary">
                  {unpriced > 0
                    ? `${unpriced} of ${totals.holdings} not priced`
                    : totals.priced === 1
                      ? '1 position priced'
                      : `${totals.priced} positions priced`}
                </Typography>
              }
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile
              label="Total P&L"
              value={signedRupees(totals.pl)}
              tone={toneOf(totals.pl)}
              valueTitle={`Rs ${totals.pl.toFixed(2)}`}
              footer={<ChangePill value={totals.plPercent} variant="soft" />}
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatTile
              label="Today's change"
              value={signedRupees(totals.dayChange)}
              tone={toneOf(totals.dayChangePercent)}
              footer={<ChangePill value={totals.dayChangePercent} variant="soft" />}
            />
          </Grid>
        </Grid>
      )}

      {totals.priced > 1 && (
        <SectionCard
          reveal
          title="Composition"
          subtitle="Where the priced book is concentrated — hover a slice or a symbol to read its share"
          sx={{ mb: 3 }}
        >
          <PortfolioComposition rows={rows} total={totals.value} />
        </SectionCard>
      )}

      <SectionCard flush reveal>
        {totals.holdings === 0 ? (
          <StatePanel
            kind="empty"
            title="No holdings yet"
            description={
              <span>
                Open a stock and use <strong>Add holding</strong> to record how many shares you own
                and what you paid — on the{' '}
                <Typography
                  component={RouterLink}
                  to="/"
                  variant="inherit"
                  sx={{ color: 'primary.main' }}
                >
                  market board
                </Typography>{' '}
                or from search.
              </span>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.symbol}
            rowHref={(r) => `/stocks/${r.symbol}`}
            ariaLabel="Portfolio holdings"
            loading={isLoading}
            error={error ? 'Could not load prices for your holdings.' : undefined}
            onRetry={refetch}
          />
        )}
      </SectionCard>
    </>
  );
}
