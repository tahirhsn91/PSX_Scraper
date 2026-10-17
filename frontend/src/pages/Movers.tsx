import { useMemo, useState } from 'react';
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { PageHeader } from '../components/ui/PageHeader';
import { DataStatus } from '../components/ui/DataStatus';
import { SectionCard } from '../components/ui/SectionCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { ChangePill } from '../components/ui/ChangePill';
import { useMovers } from '../api/hooks';
import { DASH, formatCount, formatNumber, formatVolume } from '../lib/format';
import type { Mover, MoverPeriod, MoverType } from '../types';

/**
 * The full rankings, with the period and the liquidity rule on the surface.
 *
 * The dashboard's movers card answers "what moved"; this page answers "what moved, over what, and
 * why is it on the list". Two things it refuses to do quietly:
 *
 * - quantify a move without naming the window it was measured over (the period is in the column
 *   header *and* in each row's reason), and
 * - rank a 40% move on a few hundred shares above a real one — the liquidity floor is applied
 *   server-side, and the number excluded is printed under the table.
 */

const TYPES: { value: MoverType; label: string }[] = [
  { value: 'gainers', label: 'Gainers' },
  { value: 'losers', label: 'Losers' },
  { value: 'active', label: 'Most active' },
  { value: 'unusual', label: 'Unusual volume' },
];

const PERIODS: { value: MoverPeriod; label: string }[] = [
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
];

const PERIOD_SUFFIX: Record<MoverPeriod, string> = { '1d': 'today', '1w': '5 sessions', '1m': '~20 sessions' };

export function Movers() {
  const [type, setType] = useState<MoverType>('gainers');
  const [period, setPeriod] = useState<MoverPeriod>('1d');
  const { data, isLoading, isError, error, refetch } = useMovers(type, period);

  const columns = useMemo<Column<Mover>[]>(
    () => [
      {
        key: 'symbol',
        header: 'Symbol',
        width: 96,
        nowrap: true,
        render: (r) => (
          <Typography variant="body2" fontWeight={600}>
            {r.symbol}
          </Typography>
        ),
      },
      {
        key: 'company',
        header: 'Company',
        nowrap: true,
        render: (r) => (
          <Typography variant="body2" color="text.secondary" noWrap>
            {r.companyName ?? DASH}
          </Typography>
        ),
      },
      {
        key: 'price',
        header: 'Price',
        align: 'right',
        width: 96,
        render: (r) => formatNumber(r.price),
      },
      {
        key: 'change',
        header: 'Day',
        align: 'right',
        width: 96,
        render: (r) => <ChangePill value={r.changePercent} variant="soft" />,
      },
      {
        key: 'periodReturn',
        header: `Return · ${PERIOD_SUFFIX[period]}`,
        align: 'right',
        width: 132,
        render: (r) => <ChangePill value={r.periodReturnPercent} variant="soft" />,
      },
      {
        key: 'volume',
        header: 'Volume',
        align: 'right',
        width: 104,
        render: (r) => formatVolume(r.volume) ?? DASH,
      },
      {
        key: 'relativeVolume',
        header: 'Rel. volume',
        align: 'right',
        width: 104,
        render: (r) =>
          r.relativeVolume === null ? (
            <Typography variant="caption" color="text.disabled">
              {DASH}
            </Typography>
          ) : (
            <Typography variant="body2" fontWeight={r.relativeVolume >= 2 ? 700 : 400}>
              {r.relativeVolume.toFixed(2)}×
            </Typography>
          ),
      },
      {
        key: 'reason',
        header: 'Why it is here',
        render: (r) => (
          <Typography variant="caption" color="text.secondary">
            {r.reason}
          </Typography>
        ),
      },
    ],
    [period],
  );

  const meta = data?.meta;

  return (
    <Box>
      <PageHeader
        title="Movers"
        subtitle="Ranked gainers, losers and activity — each measured over the window named in the column, not over an unstated one"
        meta={<DataStatus dataset="quotes" session />}
      />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        sx={{ mb: 2 }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={type}
          onChange={(_e, next: MoverType | null) => next && setType(next)}
          aria-label="Ranking"
        >
          {TYPES.map((t) => (
            <ToggleButton key={t.value} value={t.value}>
              {t.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            Window
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={period}
            onChange={(_e, next: MoverPeriod | null) => next && setPeriod(next)}
            aria-label="Ranking window"
          >
            {PERIODS.map((p) => (
              <ToggleButton key={p.value} value={p.value}>
                {p.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      <SectionCard flush>
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(r) => r.symbol}
          rowHref={(r) => `/stocks/${r.symbol}`}
          ariaLabel={`${TYPES.find((t) => t.value === type)?.label} ranking`}
          loading={isLoading}
          error={isError ? (error as Error)?.message ?? 'Could not load the ranking' : undefined}
          onRetry={() => refetch()}
          transitionKey={`${type}-${period}`}
          emptyTitle="Nothing to rank"
          emptyDescription="No symbol passed the liquidity floor for this window."
        />
      </SectionCard>

      {meta && (
        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {formatCount(meta.ranked)} ranked · {formatCount(meta.excludedIlliquid)} excluded for trading
            fewer than {formatCount(meta.liquidityFloorShares)} shares.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {meta.relativeVolumeFormula} · 1.00× means a normal day for that stock.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {meta.tradedValueNote}
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
