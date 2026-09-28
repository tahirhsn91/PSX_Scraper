import { useSearchParams, Link as RouterLink } from 'react-router-dom';
import { Button, Box } from '@mui/material';
import { useSearch } from '../api/hooks';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatePanel } from '../components/ui/StatePanel';
import { DataTable, type Column } from '../components/ui/DataTable';
import { DASH, formatDate, formatNumber } from '../lib/format';
import type { SearchResult } from '../types';

const columns: Column<SearchResult>[] = [
  { key: 'symbol', header: 'Symbol', width: 120, mobileRole: 'title', render: (r) => r.symbol },
  { key: 'company', header: 'Company', mobileRole: 'subtitle', render: (r) => r.companyName ?? DASH },
  { key: 'sector', header: 'Sector', hideBelow: 'md', mobileRole: 'meta', render: (r) => r.sector ?? DASH },
  {
    key: 'price',
    header: 'Price',
    align: 'right',
    width: 110,
    mobileRole: 'value',
    render: (r) => formatNumber(r.currentPrice),
  },
  {
    key: 'lastTrade',
    header: 'Last trade',
    align: 'right',
    width: 130,
    hideBelow: 'sm',
    mobileRole: 'meta',
    render: (r) => formatDate(r.lastTradeDate),
  },
];

export function SearchResults() {
  const [params] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const { data, isLoading, isError, refetch } = useSearch(query);
  const rows = data?.results ?? [];

  if (query.length === 0) {
    return (
      <Box>
        <PageHeader title="Search" crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Search' }]} />
        <SectionCard>
          <StatePanel
            kind="empty"
            title="Search for a stock"
            description="Use the search box in the header — by symbol (OGDC) or company name."
            action={
              <Button component={RouterLink} to="/" variant="outlined">
                Back to dashboard
              </Button>
            }
          />
        </SectionCard>
      </Box>
    );
  }

  return (
    <Box>
      <PageHeader
        title="Search results"
        subtitle={
          isLoading
            ? `Searching for “${query}”…`
            : `${rows.length} ${rows.length === 1 ? 'match' : 'matches'} for “${query}”`
        }
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Search' }]}
      />
      <SectionCard flush>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.symbol}
          rowHref={(r) => `/stocks/${r.symbol}`}
          loading={isLoading}
          error={isError ? 'The search request failed.' : undefined}
          onRetry={() => void refetch()}
          emptyTitle={`No matches for “${query}”`}
          emptyDescription="Check the spelling of the symbol, or try the company name instead."
          skeletonRows={5}
        />
      </SectionCard>
    </Box>
  );
}
