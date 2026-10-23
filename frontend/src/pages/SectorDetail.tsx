import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Box, Button, Grid, Stack, Typography } from '@mui/material';
import { useSectorDetail } from '../api/hooks';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatTile } from '../components/ui/StatTile';
import { DataTable, type Column } from '../components/ui/DataTable';
import { ChangePill } from '../components/ui/ChangePill';
import { DataStatus } from '../components/ui/DataStatus';
import { DASH, formatMarketCap, formatNumber } from '../lib/format';
import type { SectorConstituent } from '../types';

const COLUMNS: Column<SectorConstituent>[] = [
  { key: 'symbol', header: 'Symbol', render: (r) => r.symbol, mobileRole: 'title' },
  {
    key: 'company',
    header: 'Company',
    render: (r) => r.companyName ?? DASH,
    noWrap: true,
    hideBelow: 'md',
    mobileRole: 'subtitle',
  },
  { key: 'price', header: 'Price', align: 'right', render: (r) => formatNumber(r.currentPrice), mobileRole: 'value' },
  {
    key: 'change',
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
    key: 'volume',
    header: 'Volume',
    align: 'right',
    render: (r) => (r.volume != null ? r.volume.toLocaleString('en-PK') : DASH),
    hideBelow: 'sm',
  },
];

function MoveList({ title, rows, empty }: { title: string; rows: SectorConstituent[]; empty: string }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {empty}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {rows.map((r) => (
            <Stack
              key={r.symbol}
              // The whole row is the link — a reader who aims at the company name should land on the
              // stock page, not have to hit the three letters of the symbol.
              component={RouterLink}
              to={`/stocks/${r.symbol}`}
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
              sx={{
                textDecoration: 'none',
                color: 'inherit',
                borderRadius: 1,
                mx: -0.5,
                px: 0.5,
                py: 0.25,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {r.symbol}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" noWrap>
                  {r.companyName ?? DASH}
                </Typography>
              </Box>
              <ChangePill value={r.changePercent} />
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/**
 * One sector, in full.
 *
 * The numbers here are the ones the Sectors page aggregates — same join, same session — so a
 * drilled-in view cannot contradict the tile that led here. The classification's source and date
 * are printed because a sector label is an assertion, and an assertion without a source is just a
 * guess with a nice font.
 */
export function SectorDetailPage() {
  const [params] = useSearchParams();
  const sector = params.get('sector') ?? '';
  const { data, isLoading, error, refetch } = useSectorDetail(sector);

  const openInScreener = `/screener?sector=${encodeURIComponent(sector)}`;
  const updated = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  return (
    <>
      <PageHeader
        title={sector || 'Sector'}
        subtitle={
          data
            ? `${data.count} tracked ${data.count === 1 ? 'company' : 'companies'} · PSX classification`
            : 'Sector drill-down'
        }
        meta={<DataStatus dataset="quotes" />}
        actions={
          <Button component={RouterLink} to={openInScreener} variant="outlined" size="small">
            Open in screener
          </Button>
        }
      />

      {!sector ? (
        <SectionCard title="No sector chosen">
          <Typography variant="body2" color="text.secondary">
            Pick a sector from the <RouterLink to="/sectors">Sectors</RouterLink> page.
          </Typography>
        </SectionCard>
      ) : (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} md={3}>
              <StatTile
                label="Average move"
                value={data?.avgChangePercent != null ? `${data.avgChangePercent > 0 ? '+' : ''}${formatNumber(data.avgChangePercent)}%` : DASH}
                footer={<Typography variant="caption" color="text.secondary">mean of {data?.count ?? DASH} stocks</Typography>}
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile
                label="Market cap"
                value={formatMarketCap(data?.totalMarketCap) ?? DASH}
                footer={<Typography variant="caption" color="text.secondary">sum of the sector</Typography>}
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile
                label="Breadth"
                value={data ? `${data.advancers} up · ${data.decliners} down` : DASH}
                footer={
                  <Typography variant="caption" color="text.secondary">
                    {data ? `${data.unchanged} unchanged of ${data.count}` : ''}
                  </Typography>
                }
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatTile
                label="Volume"
                value={data?.totalVolume != null ? data.totalVolume.toLocaleString('en-PK') : DASH}
                footer={<Typography variant="caption" color="text.secondary">shares traded, last session</Typography>}
              />
            </Grid>
          </Grid>

          <SectionCard title="Biggest moves" sx={{ mb: 3 }}>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <MoveList title="Top gainers" rows={data?.gainers ?? []} empty="No stock in this sector rose." />
              </Grid>
              <Grid item xs={12} md={6}>
                <MoveList title="Top losers" rows={data?.losers ?? []} empty="No stock in this sector fell." />
              </Grid>
            </Grid>
          </SectionCard>

          <SectionCard
            title="Constituents"
            subtitle={data ? `${data.count} companies, biggest gain first` : undefined}
            action={
              <Typography variant="caption" color="text.secondary">
                {data?.source
                  ? `Classification: ${data.source}${updated ? ` · updated ${updated}` : ' · date not recorded yet'}`
                  : 'Classification source not recorded'}
              </Typography>
            }
            flush
          >
            <DataTable
              columns={COLUMNS}
              rows={data?.constituents ?? []}
              rowKey={(r) => r.symbol}
              rowHref={(r) => `/stocks/${r.symbol}`}
              ariaLabel="Sector constituents"
              loading={isLoading}
              error={error ? `Could not load ${sector}.` : undefined}
              onRetry={refetch}
              emptyTitle="No constituents"
              emptyDescription="No tracked stock carries this sector classification."
              transitionKey={sector}
            />
          </SectionCard>
        </>
      )}
    </>
  );
}
