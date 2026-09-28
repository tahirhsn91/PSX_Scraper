import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TablePagination,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/SyncRounded';
import { DataTable, type Column } from '../components/ui/DataTable';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { useSyncAll, useSyncLogs } from '../api/hooks';
import { DASH, formatDateTime, formatDuration, formatRelative, formatTime } from '../lib/format';
import type { SyncLog } from '../types';

const STATUS_COLOR: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'error',
  RUNNING: 'info',
  PENDING: 'default',
};

const STATUSES = ['SUCCESS', 'PARTIAL', 'FAILED', 'RUNNING', 'PENDING'];

/** One line of the error, with the whole thing on hover — some of these are multi-line stack text. */
function ErrorCell({ message }: { message: string | null }) {
  if (!message) return <Typography variant="body2" color="text.secondary">{DASH}</Typography>;
  const firstLine = message.split('\n')[0]!.trim();
  return (
    <Tooltip title={message} enterDelay={400}>
      <Typography variant="body2" noWrap sx={{ maxWidth: { xs: 220, md: 320 } }}>
        {firstLine}
      </Typography>
    </Tooltip>
  );
}

const columns: Column<SyncLog>[] = [
  {
    key: 'symbol',
    header: 'Symbol',
    width: 110,
    mobileRole: 'title',
    render: (l) => (
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {l.symbol ?? 'ALL'}
      </Typography>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 110,
    mobileRole: 'value',
    render: (l) => (
      <Chip size="small" variant="outlined" color={STATUS_COLOR[l.status] ?? 'default'} label={l.status} />
    ),
  },
  {
    key: 'startedAt',
    header: 'Started',
    width: 170,
    mobileRole: 'subtitle',
    render: (l) => (
      <Tooltip title={formatDateTime(l.startedAt)} enterDelay={400}>
        <span>{formatTime(l.startedAt)}</span>
      </Tooltip>
    ),
  },
  {
    key: 'completedAt',
    header: 'Completed',
    width: 110,
    hideBelow: 'md',
    mobileRole: 'meta',
    render: (l) => (l.completedAt ? formatTime(l.completedAt) : DASH),
  },
  {
    key: 'durationMs',
    header: 'Duration',
    align: 'right',
    width: 100,
    mobileRole: 'meta',
    render: (l) => formatDuration(l.durationMs),
  },
  {
    key: 'errorMessage',
    header: 'Error',
    mobileRole: 'meta',
    render: (l) => <ErrorCell message={l.errorMessage} />,
  },
];

export function SyncLogs() {
  const [status, setStatus] = useState('');
  const [symbolInput, setSymbolInput] = useState('');
  const [symbol, setSymbol] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [confirm, setConfirm] = useState(false);

  // The audit found this page dumping the newest 100 rows in one unbroken table with no way to
  // reach anything older; it now pages on the server (the API has taken page/limit/status/symbol
  // all along) and filters by symbol too.
  const [live, setLive] = useState(true);
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useSyncLogs(
    { page: page + 1, limit: rowsPerPage, status: status || undefined, symbol: symbol || undefined },
    { refetchInterval: live ? 15000 : false },
  );
  const syncAll = useSyncAll();

  // A filter can shrink the log below the page we are on — clamp so the pager and the request agree
  // (an out-of-range page makes MUI warn and shows an empty page that looks like a broken filter).
  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / rowsPerPage) - 1);
  useEffect(() => {
    // Only clamp against a loaded page: while a request is in flight `total` is 0 and clamping
    // would throw the reader back to page 1 on every navigation.
    if (!data) return;
    if (page > maxPage) setPage(maxPage);
  }, [data, page, maxPage]);

  // Debounce the symbol box: typing a six-letter symbol would otherwise fire six requests.
  useEffect(() => {
    const t = setTimeout(() => {
      setSymbol(symbolInput.trim().toUpperCase());
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [symbolInput]);

  const running = useMemo(
    () => (data?.items ?? []).filter((l) => l.status === 'RUNNING').length,
    [data],
  );

  const filtered = Boolean(status || symbol);

  return (
    <Box>
      <PageHeader
        title="Sync logs"
        subtitle="Every scrape attempt the worker has recorded, newest first"
        crumbs={[{ label: 'Market board', to: '/' }, { label: 'Sync logs' }]}
        meta={
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              {data ? `${data.total.toLocaleString()} attempt${data.total === 1 ? '' : 's'} on record` : 'Loading…'}
            </Typography>
            {running > 0 && (
              <Chip size="small" variant="outlined" color="info" label={`${running} running on this page`} />
            )}
            {dataUpdatedAt > 0 && (
              <Typography variant="caption" color="text.secondary">
                · updated {formatRelative(new Date(dataUpdatedAt))}
              </Typography>
            )}
          </Stack>
        }
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={live}
                  onChange={(e) => setLive(e.target.checked)}
                  inputProps={{ 'aria-label': 'Auto-refresh the log' }}
                />
              }
              label={<Typography variant="body2">Live</Typography>}
            />
            <Button variant="contained" startIcon={<SyncIcon />} onClick={() => setConfirm(true)}>
              Sync all
            </Button>
          </Stack>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        ariaLabel="Sync log"
        rowKey={(l) => l.id}
        loading={isLoading || (isFetching && page > 0 && (data?.items.length ?? 0) === 0)}
        error={isError ? (error as Error)?.message ?? 'Failed to load logs' : undefined}
        onRetry={() => refetch()}
        emptyTitle={filtered ? 'No attempts match this filter' : 'No sync attempts recorded yet'}
        emptyDescription={
          filtered
            ? 'Clear the filters to see the whole log.'
            : 'Start a sync from the market board and it will appear here.'
        }
        emptyAction={
          filtered ? (
            <Button
              size="small"
              onClick={() => {
                setStatus('');
                setSymbolInput('');
                setPage(0);
              }}
            >
              Clear filters
            </Button>
          ) : undefined
        }
        skeletonRows={8}
        cardsBelow="md"
        toolbar={
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Symbol"
              placeholder="e.g. OGDC"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              sx={{ minWidth: 140 }}
            />
            {filtered && (
              <Button
                size="small"
                onClick={() => {
                  setStatus('');
                  setSymbolInput('');
                  setPage(0);
                }}
              >
                Clear
              </Button>
            )}
          </Stack>
        }
        pagination={
          <TablePagination
            component="div"
            count={total}
            page={Math.min(page, maxPage)}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[25, 50, 100]}
            aria-label="Sync log pages"
          />
        }
      />

      <ConfirmDialog
        open={confirm}
        title="Sync every tracked stock?"
        message="This enqueues a scrape for every tracked symbol — it does not change which symbols are tracked, and the worker will work through them on its own queue."
        confirmLabel="Sync all"
        pending={syncAll.isPending}
        pendingLabel="Enqueuing…"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          syncAll.mutate(undefined, { onSettled: () => setConfirm(false) });
        }}
      />
    </Box>
  );
}
