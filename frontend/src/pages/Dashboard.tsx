import { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  TableSortLabel,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip, Skeleton, Alert,
  Stack, Grid, Card, CardContent, LinearProgress, Snackbar, IconButton, MenuItem, InputAdornment,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import SyncIcon from '@mui/icons-material/Sync';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ShowChartRounded from '@mui/icons-material/ShowChartRounded';
import { useStocks, useAddStock, useSyncStatus, useSyncAll, useIndices } from '../api/hooks';
import { IndicesPanel } from '../components/IndicesPanel';
import { IndicesTicker } from '../components/IndicesTicker';
import { FailuresPanel } from '../components/FailuresPanel';
import { SearchBar } from '../components/SearchBar';
import type { ApiError } from '../api/client';
import type { StockSortField, SortOrder, StockListGroup } from '../types';

/**
 * The pair of arrows on a sortable column: down for ascending, up for descending.
 *
 * Both are always drawn, so a column reads as sortable before it has been touched — MUI's own
 * label hides the icon until hover, and on a phone there is no hover. The active direction is
 * the solid arrow, the other stays faint. Tapping the header toggles between the two.
 */
function SortArrows({ active, direction }: { active?: boolean; direction?: 'asc' | 'desc' }) {
  const faint = 0.3;
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 0, ml: 0.5, verticalAlign: 'middle' }}
    >
      <ArrowUpwardRounded sx={{ fontSize: 11, opacity: active && direction === 'desc' ? 1 : faint }} />
      <ArrowDownwardRounded sx={{ fontSize: 11, mt: '-2px', opacity: active && direction === 'asc' ? 1 : faint }} />
    </Box>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addStock = useAddStock();
  const syncAll = useSyncAll();
  const [open, setOpen] = useState(false);
  const [confirmSyncAll, setConfirmSyncAll] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [justTriggered, setJustTriggered] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // The universe worker (#41) puts every listed security on this dashboard, so the table is
  // paged rather than cut off at the first N symbols.
  //
  // Page one is the KSE-100 — the index's own published member list — and the pages after it are
  // every other tracked symbol, `rowsPerPage` at a time. Page one is therefore as long as the
  // index is (99 today, not a hardcoded 100): "100 rows" is the index's size, so it follows the
  // data rather than a constant that a rebalance would silently contradict.
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  // Which list the table shows: the KSE-100's own published member list, or every tracked symbol.
  // KSE-100 is the default — it is the list a reader opens the dashboard for, and it is the only
  // membership the scraper stores today.
  const [scope, setScope] = useState<'kse100' | 'all'>('kse100');
  const indexed = scope === 'kse100';
  // The API caps `limit` at 200 — comfortably above any KSE-100 membership, so the index's member
  // list arrives in a single request and needs no paging of its own.
  const group: StockListGroup | undefined = indexed ? 'kse100' : undefined;
  const limit = indexed ? 200 : rowsPerPage;
  // Sorting is done by the API, not here: the table shows 50 of ~500 symbols, so ordering in
  // the browser would only shuffle the page you happen to be looking at.
  const [sort, setSort] = useState<StockSortField | undefined>(undefined);
  const [order, setOrder] = useState<SortOrder>('asc');

  /** Another column starts ascending; the same one flips. The page resets with the order —
   *  page 4 of "volume descending" means nothing once the order changes. */
  const handleSort = (field: StockSortField) => {
    if (sort === field) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setOrder('asc');
    }
    setPage(0);
  };

  /** A sortable numeric header. */
  const sortableHeader = (label: string, field: StockSortField) => (
    <TableCell align="right" sortDirection={sort === field ? order : false}>
      <TableSortLabel
        active={sort === field}
        direction={order}
        onClick={() => handleSort(field)}
        // Deliberately not forwarding MUI's icon className: that class fades the icon out on
        // unsorted columns and rotates it for the direction, and both would fight the two-arrow
        // affordance. The arrows are drawn entirely from this component's own state (which
        // column is sorted, and which way), so nothing depends on MUI's internal icon props.
        IconComponent={() => <SortArrows active={sort === field} direction={order} />}
        // "52W Low" / "52W High" would otherwise break onto two lines and drop their arrows
        // out of line with the rest of the header.
        sx={{ whiteSpace: 'nowrap' }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  // Poll queue status continuously; also while a "sync all" just fired so the
  // active/waiting counts (and the progress bar) reflect the fan-out in real time.
  const { data: status } = useSyncStatus(true);
  const syncCounts = status?.queues['stock-sync'];
  const inFlightCount = syncCounts?.active ?? 0;
  const queuedCount = syncCounts?.waiting ?? 0;
  // Failures across every queue, not just this one. The single-queue number was also BullMQ's
  // *set size*, which counts entries whose job has already been trimmed away — see FailuresPanel.
  const failedCount = Object.values(status?.queues ?? {})
    .reduce((n, counts) => n + (counts.failed ?? 0), 0);
  const syncingAll = justTriggered || inFlightCount > 0 || queuedCount > 0;

  // Keep the stock table itself fresh (prices, last-synced) while a sync is running.
  const { data, isLoading, isError } = useStocks(
    // The index scope is one request (the whole member list); the all scope pages normally.
    indexed ? 1 : page + 1,
    limit,
    syncingAll,
    sort,
    order,
    group,
  );

  // Both group sizes arrive with any grouped request, so the tracked-stocks card can count the
  // whole universe (the index's members plus the rest) without a second call. An ungrouped
  // request answers with `total` instead.
  const kse100Count = data?.groups?.kse100 ?? 0;
  const restCount = data?.groups?.rest ?? 0;
  const universe = data?.groups ? kse100Count + restCount : data?.total ?? 0;
  // The index scope is a single page — it holds the whole member list — and the all scope pages
  // by the size the reader chose.
  const scopeTotal = data?.total ?? 0;
  const totalPages = indexed ? 1 : Math.max(1, Math.ceil(scopeTotal / rowsPerPage));
  // The index board is scraped separately from the stocks: it comes from the exchange's own
  // market-summary page, and it is a handful of rows rather than a paginated list.
  const { data: indexBoard, isLoading: indicesLoading, isError: indicesError } = useIndices(syncingAll);

  // Once the fan-out has actually started showing up in the queue, stop forcing
  // the "just triggered" state — the real counts take over.
  useEffect(() => {
    if (justTriggered && (inFlightCount > 0 || queuedCount > 0)) {
      setJustTriggered(false);
    }
  }, [justTriggered, inFlightCount, queuedCount]);

  // When syncing finishes (active + waiting both drop to 0), do one final refresh
  // so the table's prices / last-synced values are guaranteed current, then notify.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !syncingAll) {
      qc.invalidateQueries({ queryKey: ['stocks'] });
      setToast('Sync complete — all stocks are up to date.');
    }
    wasSyncing.current = syncingAll;
  }, [syncingAll, qc]);

  const submit = () => {
    const s = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(s)) return;
    addStock.mutate(s, { onSuccess: () => { setOpen(false); setSymbol(''); } });
  };

  const runSyncAll = () => {
    setConfirmSyncAll(false);
    syncAll.mutate(undefined, {
      onSuccess: () => {
        setJustTriggered(true);
        setToast('Sync started for all tracked stocks.');
      },
      onError: () => setToast('Failed to start sync — please try again.'),
    });
  };

  return (
    <Box>
      {/* The ribbon is its own full-width row: as a flex child of the header below it competed
          with the title for space and squeezed it into a wrapped, right-hand corner. */}
      <IndicesTicker indices={indexBoard?.items} />

      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={2}>
        <Typography
          variant="h5"
          sx={{
            // Kept on one line and slid the way the ribbon above slides, but inside its own box so
            // the title stays readable. A reader who has asked their system for less motion gets a
            // still title.
            whiteSpace: 'nowrap',
            '@keyframes titleSlide': {
              '0%': { transform: 'translateX(0)' },
              '50%': { transform: 'translateX(-10px)' },
              '100%': { transform: 'translateX(0)' },
            },
            animation: 'titleSlide 5s ease-in-out infinite',
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          Dashboard Scrapper
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<SyncIcon />}
            disabled={syncingAll || syncAll.isPending}
            onClick={() => setConfirmSyncAll(true)}
          >
            {syncingAll ? 'Syncing All…' : 'Sync All'}
          </Button>
          <Button variant="contained" onClick={() => setOpen(true)}>Add Stock</Button>
        </Stack>
      </Stack>

      <Box mb={3}><SearchBar /></Box>

      <Grid container spacing={2} mb={1}>
        {[
          // The universe, not the page: a grouped request answers with both group sizes, so this
          // card counts everything tracked (the index's members plus the rest) either way.
          { label: 'Tracked stocks', value: data ? universe : '—' },
          { label: 'Active syncs', value: syncCounts?.active ?? 0 },
          { label: 'Waiting', value: syncCounts?.waiting ?? 0 },
          { label: 'Failed', value: failedCount },
        ].map((c) => (
          <Grid item xs={6} md={3} key={c.label}>
            <Card variant="outlined"><CardContent>
              <Typography variant="body2" color="text.secondary">{c.label}</Typography>
              <Typography variant="h5">{c.value}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      {syncingAll && (
        <Box mb={2}>
          <LinearProgress />
          <Typography variant="caption" color="text.secondary">
            Syncing all tracked stocks — {inFlightCount} active, {queuedCount} waiting. This page updates automatically.
          </Typography>
        </Box>
      )}

      {isError && <Alert severity="error">Failed to load stocks.</Alert>}

      <FailuresPanel status={status} />

      {/* The board reports its own loading / failure / empty state: a silent gap would be
          indistinguishable from a board that has not arrived yet. */}
      <IndicesPanel indices={indexBoard?.items} isLoading={indicesLoading} isError={indicesError} />

      <Paper variant="outlined">
        {/* Which list the table below lists, above the table's first column. Deliberately its own
            object on the panel rather than another row of the table: a caption label, a 44px
            rounded control with a leading glyph, and a menu whose items are rounded and tinted. */}
        <Stack sx={{ px: 2, pt: 1.5 }}>
          <Typography
            variant="caption"
            id="index-scope-label"
            sx={{
              color: 'text.secondary',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              mb: 0.75,
            }}
          >
            Indices
          </Typography>
          <TextField
            select
            size="small"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as 'kse100' | 'all');
              setPage(0);
            }}
            // The caption above is this control's name — it is the visible label, so the control
            // borrows it rather than carrying a floating label that would sit inside a box this
            // short and read as a value.
            sx={{
              minWidth: 240,
              // A column Stack stretches its children to the panel's width; a filter reads as a
              // control, not a form field spanning 1,100px.
              alignSelf: 'flex-start',
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                transition: 'border-color .15s ease, box-shadow .15s ease',
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'text.primary' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'primary.main',
                  borderWidth: 1.5,
                },
                // A ring rather than MUI's grey fill, so focus is visible without the field
                // looking disabled. Primary at low alpha holds up in light and dark alike.
                '&.Mui-focused': {
                  boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.primary.main, 0.18)}`,
                },
              },
              '& .MuiSelect-select': { fontWeight: 600, py: 1.25 },
              '& .MuiSelect-select:focus': { backgroundColor: 'transparent' },
              '& .MuiSelect-icon': { color: 'text.secondary' },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <ShowChartRounded fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
            }}
            SelectProps={{
              // MUI gives the combobox its own generated label id; point it at the visible caption
              // instead, so the control is announced as "Indices" and not as its own value.
              labelId: 'index-scope-label',
              MenuProps: {
                PaperProps: {
                  sx: { mt: 1, borderRadius: 2, border: '1px solid', borderColor: 'divider', boxShadow: 4 },
                },
                MenuListProps: { sx: { py: 0.75 } },
              },
            }}
          >
            {[
              { value: 'kse100', label: 'KSE100' },
              { value: 'all', label: 'All' },
            ].map((option) => (
              <MenuItem
                key={option.value}
                value={option.value}
                sx={{
                  mx: 0.75,
                  borderRadius: 1,
                  '&.Mui-selected': {
                    fontWeight: 600,
                    color: 'primary.main',
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                  },
                }}
              >
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {/* Seven columns do not fit a phone. TableContainer gives the table its own horizontal
            scroll area; without one the table pushed the *page* sideways — at a 384px viewport
            the document measured 835px (a 451px overflow), so every row ran off the screen. */}
        <TableContainer>
          {/* The rows look the same whichever list is on screen, so the table keeps a name for
              screen readers even though the page does not spell it out above the rows. */}
          <Table aria-label={indexed ? 'KSE-100 Index constituents' : 'All tracked symbols'}>
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                {/* Company is the one column a phone cannot afford: the widest, the least
                    load-bearing, and one tap away on the detail page. The numbers are what a
                    mobile dashboard is for, so they stay at every width. */}
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Company</TableCell>
                {sortableHeader('Price', 'price')}
                {sortableHeader('52W Low', 'week52Low')}
                {sortableHeader('52W High', 'week52High')}
                {sortableHeader('Change %', 'changePercent')}
                {sortableHeader('Volume', 'volume')}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton /></TableCell></TableRow>
                ))}
              {data?.items.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    {indexed
                      ? 'No KSE-100 members yet — the index’s member list has not been fetched.'
                      : 'No tracked symbols.'}
                  </TableCell>
                </TableRow>
              )}
              {data?.items.map((s) => (
                <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/stocks/${s.symbol}`)}>
                  <TableCell><strong>{s.symbol}</strong></TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{s.companyName ?? '—'}</TableCell>
                  <TableCell align="right">{s.currentPrice ?? '—'}</TableCell>
                  {/* Null means "the page had no 52-week block", so it reads as a dash rather
                      than a zero — the API never substitutes a value here. */}
                  <TableCell align="right">{s.week52Low ?? '—'}</TableCell>
                  <TableCell align="right">{s.week52High ?? '—'}</TableCell>
                  <TableCell align="right">
                    {s.changePercent != null ? (
                      <Chip size="small" color={s.changePercent >= 0 ? 'success' : 'error'} label={`${s.changePercent.toFixed(2)}%`} />
                    ) : '—'}
                  </TableCell>
                  {/* Thousands separators: session volumes run to seven figures. */}
                  <TableCell align="right">{s.volume != null ? s.volume.toLocaleString() : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {/* A pager of our own, not MUI's TablePagination: that control assumes every page is
            `rowsPerPage` rows long and derives its "1–50 of 508" label from that. The index scope
            is one page holding the whole member list (99 today), so its label would be wrong on
            the one page the reader lands on. This counts *pages*. */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="flex-end"
          spacing={1.5}
          sx={{ px: 2, py: 1, flexWrap: 'wrap' }}
        >
          <Typography variant="body2" color="text.secondary">
            Page {page + 1} of {totalPages} · {scopeTotal} rows
          </Typography>
          <IconButton
            size="small"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Next page"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
          <TextField
            select
            size="small"
            label="Rows"
            value={rowsPerPage}
            // Selecting a size lands on the first page of the list it governs.
            onChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            sx={{ minWidth: 100 }}
          >
            {[25, 50, 100, 250].map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add Stock</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth margin="dense" label="PSX Symbol" placeholder="FFC"
            value={symbol} onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {addStock.isError && <Alert severity="error" sx={{ mt: 1 }}>{(addStock.error as unknown as ApiError)?.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={addStock.isPending}>Add & Scrape</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmSyncAll} onClose={() => setConfirmSyncAll(false)} fullWidth maxWidth="xs">
        <DialogTitle>Sync all stocks?</DialogTitle>
        <DialogContent>
          <Typography>
            This fetches the latest data for all {data?.total ?? 0} tracked stock{data?.total === 1 ? '' : 's'} from PSX
            and Sarmaaya. It runs in the background — you can keep using the dashboard while it completes.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSyncAll(false)}>Cancel</Button>
          <Button variant="contained" onClick={runSyncAll} disabled={syncAll.isPending}>
            Sync All
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
