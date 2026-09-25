import { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  TableSortLabel,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Skeleton, Alert,
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
import type { StockSortField, SortOrder } from '../types';
import { formatMarketCap, formatRupees } from '../lib/format';

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
  // KSE100 opens the dashboard — the index's own published member list — and every other scope is
  // the same shape: an index scope asks the API for that index's tracked constituents, `all` asks
  // for every tracked symbol. An index list is as long as the index is (99 today, not a hardcoded
  // 100), so the row count follows the data rather than a constant a rebalance would silently
  // contradict.
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  /**
   * Which list the table shows. `'all'` is the whole tracked universe; any other value is a PSX
   * index symbol whose tracked constituents the API filters the list to. KSE100 is the default —
   * the list a reader opens the dashboard for.
   *
   * The symbols are not hardcoded here: they are the index board's own 17 (below), so the dropdown
   * cannot offer an index PSX does not publish, and a new one appears without a frontend change.
   */
  const [scope, setScope] = useState('KSE100');
  const indexed = scope !== 'all';
  // The API caps `limit` at 200 — comfortably above any index membership stored today, so an
  // index's member list arrives in a single request. An index that grows past 200 pages like any
  // other list, which is why the page count is derived from this `limit` and not assumed to be 1.
  // The stocks endpoint rejects limit > 200, so clamp rather than trust the options to match it.
  const limit = Math.min(indexed ? 200 : rowsPerPage, 200);
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
    // Every scope pages the same way; the index scope just asks for 200 rows at a time.
    page + 1,
    limit,
    syncingAll,
    sort,
    order,
    // Deliberately no `group`: `index` is this table's scope filter, and All means no filter at
    // all — sending `group` as well would intersect an index's members with the KSE-100's.
    undefined,
    indexed ? scope : undefined,
  );

  // Both group sizes arrive with any scoped request — grouped or index-filtered — so the
  // tracked-stocks card can count the whole universe (the index's members plus the rest) without a
  // second call. An unscoped request answers with `total` instead.
  const kse100Count = data?.groups?.kse100 ?? 0;
  const restCount = data?.groups?.rest ?? 0;
  const universe = data?.groups ? kse100Count + restCount : data?.total ?? 0;
  // `total` is the *filtered* count: the index's tracked members, or the whole universe under All.
  // The page count follows from that same number and the size this scope actually requests, so the
  // label, the arrows and the rows on screen are all derived from one source and cannot disagree.
  const scopeTotal = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(scopeTotal / limit));
  // A page number can outlive the list it pointed at — a rebalance drops an index below the page
  // the reader is on. Above the last page the table would render no rows and a pager reading
  // "Page 4 of 2"; the state is corrected instead. (A scope change already resets the page.)
  useEffect(() => {
    if (data && page > totalPages - 1) setPage(totalPages - 1);
  }, [data, page, totalPages]);
  // The index board is scraped separately from the stocks: it comes from the exchange's own
  // market-summary page, and it is a handful of rows rather than a paginated list.
  const { data: indexBoard, isLoading: indicesLoading, isError: indicesError } = useIndices(syncingAll);
  // The dropdown's index options are the board's own symbols, taken from the API at runtime rather
  // than a hardcoded list: the selector then cannot offer an index PSX does not publish, and an
  // index PSX adds appears without a frontend change.
  const indexSymbols = indexBoard?.items.map((i) => i.symbol) ?? [];
  // MUI renders the *selected option's* label, so a selected value with no matching option renders
  // an empty control. KSE100 is selected on first paint and the board arrives a moment later, so
  // the current scope is always in the list rather than waiting for the fetch.
  const indexOptions = scope !== 'all' && !indexSymbols.includes(scope)
    ? [scope, ...indexSymbols]
    : indexSymbols;

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
          // Deliberately static: this heading used to slide 10px sideways on a 5s loop, which read
          // as the page twitching while the eye was trying to read it. The ribbon above still
          // glides — the heading no longer competes with it, and nothing here needs a
          // reduced-motion escape hatch because there is no motion left to switch off.
          sx={{ whiteSpace: 'nowrap' }}
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
          // The universe, not the page: any scoped request (an index, or a group) answers with both
          // group sizes, so this card counts everything tracked (the index's members plus the rest)
          // in every scope — it reads 508 even while the table shows one index's 99.
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
            object on the panel rather than another row of the table: a caption label, a rounded
            control with a leading glyph, and a menu whose items are rounded and tinted.
            `All` is the whole tracked universe (no filter on the wire); every other option is an
            index symbol sent as `index=<symbol>`. */}
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
              setScope(e.target.value);
              // A page number belongs to the list it was counted in.
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
                // A Select menu defaults to anchoring so the *selected item* can sit over the
                // field, which hides both the field and the value you are about to change; and
                // 18 options make a list taller than the space under a laptop field. So the list
                // is pinned to the field's lower edge and capped: it opens just below the box,
                // the selected row scrolls into view inside it, and the control stays readable
                // while you choose.
                anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
                transformOrigin: { vertical: 'top', horizontal: 'left' },
                PaperProps: {
                  sx: {
                    mt: 1,
                    maxHeight: 320,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: 4,
                  },
                },
                MenuListProps: { sx: { py: 0.75 } },
              },
            }}
          >
            {[
              { value: 'all', label: 'All' },
              ...indexOptions.map((s) => ({ value: s, label: s })),
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
              screen readers even though the page does not spell it out above the rows — and it
              names the scope, so "which index am I looking at" survives with the table alone. */}
          <Table aria-label={indexed ? `${scope} index constituents` : 'All tracked symbols'}>
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                {/* Company is the one column a phone cannot afford: the widest, the least
                    load-bearing, and one tap away on the detail page. The numbers are what a
                    mobile dashboard is for, so they stay at every width. */}
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Company</TableCell>
                {/* Labelled "Current", not "Price": it is the latest session's reading, and the two
                    columns beside it are also prices. The sort key stays `price` — the label is
                    the only thing changing here. */}
                {sortableHeader('Current', 'price')}
                {sortableHeader('52W Low', 'week52Low')}
                {sortableHeader('52W High', 'week52High')}
                {/* Sortable like its neighbours: the column and its ordering shipped together,
                    so a header that could not be clicked would be the odd one out. */}
                {sortableHeader('Change', 'change')}
                {sortableHeader('Change %', 'changePercent')}
                {sortableHeader('Volume', 'volume')}
                {/* Last by request. Sortable like its neighbours even though most rows are
                    currently null — the ordering places nulls last, and a column that cannot be
                    clicked would be the odd one out. */}
                {sortableHeader('Market Cap', 'marketCap')}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={9}><Skeleton /></TableCell></TableRow>
                ))}
              {/* An empty index scope is a fact about *that index*, not an empty table. Naming the
                  symbol is what separates "PSX's KMI30 membership has not been stored yet" from
                  "nothing is tracked" — and the row stays empty rather than being filled with
                  invented constituents, because there are none to show. */}
              {data?.items.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    {indexed
                      ? `No tracked members stored for ${scope} yet.`
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
                  {/* The absolute move in the exchange's own units, toned like the percent beside
                      it so the pair reads as one idea. `change` is optional on the wire: a session
                      whose row carried none shows a dash, not a zero. */}
                  <TableCell align="right">
                    {s.change != null ? (
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          color:
                            s.change > 0 ? 'success.main'
                            : s.change < 0 ? 'error.main'
                            : 'text.secondary',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {`${s.change > 0 ? '▲' : s.change < 0 ? '▼' : '·'} ${Math.abs(s.change).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                      </Typography>
                    ) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {/* The value itself is toned rather than seated in a filled pill: a column of
                        badges reads as a column of badges, and the whole table's numbers stop
                        lining up. Direction is carried twice — the glyph and the tone — so the
                        column still reads for anyone who cannot separate the two hues, and a flat
                        0 is neither good news nor bad. */}
                    {s.changePercent != null ? (
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          color:
                            s.changePercent > 0 ? 'success.main'
                            : s.changePercent < 0 ? 'error.main'
                            : 'text.secondary',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {`${s.changePercent > 0 ? '▲' : s.changePercent < 0 ? '▼' : '·'} ${Math.abs(s.changePercent).toFixed(2)}%`}
                      </Typography>
                    ) : '—'}
                  </TableCell>
                  {/* Thousands separators: session volumes run to seven figures. */}
                  <TableCell align="right">{s.volume != null ? s.volume.toLocaleString() : '—'}</TableCell>
                  {/* Abbreviated in the cell, exact in the title. A null cap is "not reported" —
                      a dash, never a zero, and never inferred from the price. */}
                  <TableCell
                    align="right"
                    title={s.marketCap != null ? formatRupees(s.marketCap) : undefined}
                  >
                    {formatMarketCap(s.marketCap) ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {/* A pager of our own, not MUI's TablePagination: that control assumes every page is
            `rowsPerPage` rows long and derives its "1–50 of 508" label from that. An index scope
            asks the API for 200 rows at a time whatever the rows control says, so that label would
            be wrong on the page the reader lands on. This counts *pages* — from the filtered total
            and the size this scope actually requests. */}
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
            {/* 200 is the API's hard cap on `limit` (the validator rejects more), so offering
                250 here only ever produced a 400 in the All scope. */}
            {[25, 50, 100, 200].map((size) => (
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
            This fetches the latest data for all {universe} tracked stock{universe === 1 ? '' : 's'} from PSX
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
