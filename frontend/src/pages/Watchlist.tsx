import { Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useStocks } from '../api/hooks';
import { useWatchlist } from '../lib/watchlist';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { ShariahMark } from '../components/ui/ShariahMark';
import { WatchButton } from '../components/WatchButton';
import { ChangePill } from '../components/ui/ChangePill';
import { StatePanel } from '../components/ui/StatePanel';
import { formatMarketCap, formatNumber, DASH } from '../lib/format';
import type { StockListItem } from '../types';

/**
 * The watchlist view. The list itself lives in localStorage (`lib/watchlist.ts`); this page asks the
 * server for those specific symbols through the list endpoint's `symbols` filter, so it reuses the
 * exact same rows and ratio fields as the screener rather than issuing one detail request per symbol.
 */
export function Watchlist() {
  const { symbols, clear } = useWatchlist();
  const { data, isLoading, error, refetch } = useStocks(
    1,
    50,
    false,
    'symbol',
    'asc',
    undefined,
    undefined,
    symbols.length > 0 ? { symbols } : undefined,
  );

  const columns: Column<StockListItem>[] = [
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
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (r) => formatNumber(r.currentPrice),
      mobileRole: 'value',
    },
    {
      key: 'changePercent',
      header: 'Change',
      align: 'right',
      render: (r) => <ChangePill value={r.changePercent} />,
      mobileRole: 'meta',
    },
    {
      key: 'marketCap',
      header: 'Market cap',
      align: 'right',
      render: (r) => formatMarketCap(r.marketCap) ?? DASH,
      hideBelow: 'sm',
    },
    {
      key: 'watch',
      header: '',
      align: 'right',
      render: (r) => <WatchButton symbol={r.symbol} />,
      width: 56,
    },
  ];

  return (
    <>
      <PageHeader
        title="Watchlist"
        subtitle="The stocks you are following, stored on this device"
        actions={
          symbols.length > 0 ? (
            <Button variant="outlined" size="small" onClick={clear}>
              Clear watchlist
            </Button>
          ) : undefined
        }
      />
      <SectionCard flush>
        {symbols.length === 0 ? (
          <StatePanel
            kind="empty"
            title="No stocks yet"
            description={
              <span>
                Tap the star beside any stock to follow it — on the{' '}
                <Typography component={RouterLink} to="/" variant="inherit" sx={{ color: 'primary.main' }}>
                  dashboard
                </Typography>{' '}
                or on a stock's own page.
              </span>
            }
          />
        ) : (
          <DataTable
            rowBadge={(r) => (r.shariahCompliant ? <ShariahMark /> : null)}
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(r) => r.symbol}
            rowHref={(r) => `/stocks/${r.symbol}`}
            ariaLabel="Watchlist"
            loading={isLoading}
            error={error ? 'Could not load the watchlist.' : undefined}
            onRetry={refetch}
          />
        )}
      </SectionCard>
    </>
  );
}
