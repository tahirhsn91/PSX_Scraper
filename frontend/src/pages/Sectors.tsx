import { useSectors } from '../api/hooks';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { ChangePill } from '../components/ui/ChangePill';
import { SectorHeatmap } from '../components/SectorHeatmap';
import { formatCount, formatMarketCap, DASH } from '../lib/format';
import type { SectorSummary } from '../types';

/**
 * The sector browser. Each row links into the screener pre-scoped to that sector, so there is one
 * place to slice the universe and no duplicated filter UI.
 */
export function Sectors() {
  const { data, isLoading, error, refetch } = useSectors();
  const rows = data?.items ?? [];

  const columns: Column<SectorSummary>[] = [
    {
      key: 'sector',
      header: 'Sector',
      render: (r) => r.sector,
      mobileRole: 'title',
      noWrap: true,
    },
    {
      key: 'count',
      header: 'Stocks',
      align: 'right',
      render: (r) => formatCount(r.count),
      mobileRole: 'value',
    },
    {
      key: 'avgChange',
      header: 'Avg change',
      align: 'right',
      render: (r) => <ChangePill value={r.avgChangePercent} />,
      mobileRole: 'meta',
    },
    {
      key: 'marketCap',
      header: 'Market cap',
      align: 'right',
      render: (r) => formatMarketCap(r.totalMarketCap) ?? DASH,
      hideBelow: 'sm',
    },
    {
      key: 'advancers',
      header: 'Advancers',
      align: 'right',
      render: (r) => formatCount(r.advancers),
      hideBelow: 'md',
    },
    {
      key: 'decliners',
      header: 'Decliners',
      align: 'right',
      render: (r) => formatCount(r.decliners),
      hideBelow: 'md',
    },
  ];

  return (
    <>
      <PageHeader
        title="Sectors"
        subtitle="Every sector on the exchange, with its average move and market size"
      />
      {rows.length > 0 && (
        <SectionCard
          title="Sector heat"
          subtitle="Colour is each sector's average move this session — green up, red down. Tiles are ordered by market size."
          sx={{ mb: 3 }}
        >
          <SectorHeatmap sectors={rows} />
        </SectionCard>
      )}
      <SectionCard flush reveal>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.sector}
          rowHref={(r) => `/screener?sector=${encodeURIComponent(r.sector)}`}
          ariaLabel="Sectors"
          loading={isLoading}
          error={error ? 'Could not load sectors.' : undefined}
          onRetry={refetch}
          emptyTitle="No sectors yet"
          emptyDescription="Sector aggregates appear once stocks carry a sector and a live reading."
        />
      </SectionCard>
    </>
  );
}
