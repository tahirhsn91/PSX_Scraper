import { useDividends } from '../api/hooks';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { formatNumber, formatDate, DASH } from '../lib/format';
import type { DividendEvent, YieldRow } from '../types';

const upcomingColumns: Column<DividendEvent>[] = [
  {
    key: 'symbol',
    header: 'Symbol',
    render: (d) => d.symbol,
    mobileRole: 'title',
  },
  {
    key: 'company',
    header: 'Company',
    render: (d) => d.companyName ?? DASH,
    noWrap: true,
    hideBelow: 'md',
  },
  {
    key: 'announced',
    header: 'Announced',
    align: 'right',
    render: (d) => formatDate(d.announcementDate),
    mobileRole: 'meta',
  },
  {
    key: 'dividend',
    header: 'Dividend',
    align: 'right',
    render: (d) => (d.dividend != null ? `Rs ${formatNumber(d.dividend)}` : DASH),
    mobileRole: 'value',
  },
];

const yieldColumns: Column<YieldRow>[] = [
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
    key: 'sector',
    header: 'Sector',
    render: (r) => r.sector ?? DASH,
    noWrap: true,
    hideBelow: 'md',
  },
  {
    key: 'yield',
    header: 'Yield',
    align: 'right',
    render: (r) => (r.dividendYield != null ? `${formatNumber(r.dividendYield)}%` : DASH),
    mobileRole: 'value',
  },
  {
    key: 'price',
    header: 'Price',
    align: 'right',
    render: (r) => formatNumber(r.currentPrice),
    mobileRole: 'meta',
  },
];

/**
 * Dividend calendar and the highest current yields. The PSX source publishes only the announcement
 * date (book closure and payment date are not carried), so the calendar is honest about that rather
 * than inventing dates.
 */
export function Dividends() {
  const { data, isLoading, error, refetch } = useDividends();
  const upcoming = data?.upcoming ?? [];
  const topYield = data?.topYield ?? [];

  return (
    <>
      <PageHeader
        title="Dividends"
        subtitle="Upcoming announcements and the market's highest yields — the source carries only the announcement date"
      />
      <SectionCard
        title="Upcoming dividends"
        subtitle="Announced, with the per-share dividend"
        flush
        sx={{ mb: 3 }}
      >
        <DataTable
          columns={upcomingColumns}
          rows={upcoming}
          rowKey={(d) => d.symbol}
          rowHref={(d) => `/stocks/${d.symbol}`}
          ariaLabel="Upcoming dividends"
          loading={isLoading}
          error={error ? 'Could not load dividends.' : undefined}
          onRetry={refetch}
          emptyTitle="No upcoming dividends"
          emptyDescription="New announcements appear here once the source reports them."
        />
      </SectionCard>
      <SectionCard title="Highest yields" subtitle="Ranked by dividend yield, highest first" flush>
        <DataTable
          columns={yieldColumns}
          rows={topYield}
          rowKey={(r) => r.symbol}
          rowHref={(r) => `/stocks/${r.symbol}`}
          ariaLabel="Highest dividend yields"
          loading={isLoading}
          error={error ? 'Could not load yields.' : undefined}
          onRetry={refetch}
          emptyTitle="No yields yet"
          emptyDescription="Yield rankings appear once dividend and price data are both present."
        />
      </SectionCard>
    </>
  );
}
