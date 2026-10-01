import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TablePagination,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import SyncIcon from "@mui/icons-material/SyncRounded";
import AddIcon from "@mui/icons-material/AddRounded";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAddStock, useIndices, useStocks, useSyncAll, useSyncStatus } from "../api/hooks";
import { FailuresPanel } from "../components/FailuresPanel";
import { IndicesPanel } from "../components/IndicesPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard } from "../components/ui/SectionCard";
import { StatTile } from "../components/ui/StatTile";
import { ChangePill } from "../components/ui/ChangePill";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DataTable, type Column } from "../components/ui/DataTable";
import { useToast } from "../components/ui/ToastProvider";
import { DASH, formatCount, formatDateTime, formatMarketCap, formatNumber, formatRelative, formatRupees, formatSigned } from "../lib/format";
import type { StockListItem, StockListGroup, StockSortField, SortOrder } from "../types";
import type { ApiError } from "../api/client";

/**
 * How each index is named in a tooltip. The board's own tiles say `KSE 100`, so a contribution is
 * described with the same name the reader sees above it rather than the payload's `KSE100`.
 */
const INDEX_LABELS: Record<string, string> = {
  KSE100: "KSE-100",
  ALLSHR: "ALLSHR market",
};

/**
 * The market board.
 *
 * One table for the whole tracked universe, sorted **server-side** (`sort`/`order` on the API): the
 * list is paginated, so sorting fifty rows in the browser would reorder the page and claim an order
 * the data does not have. The row-wise layout is the design at **every** width — a phone gets the
 * same eleven columns as a desktop, not a card list, so the table carries a width floor and its own
 * container takes the horizontal scroll (the page never scrolls sideways).
 *
 * The eleven columns share the ~1215px the container gives them, which is why the widths below are
 * percentages that add up to 79%: the table is laid out `fixed` (see `DataTable`) and the Company
 * column, the only one without a width, takes what is left (measured 252px). Each column is at least
 * as wide as its own `nowrap` header label, whatever its data — a column narrower than its label
 * pushes the table past the container and puts a scrollbar under it, which is how the last three
 * widths were chosen. What still does not fit is clipped by its own cell with a `title` for the full
 * value, rather than wrapping and making every row two lines tall.
 */
const COLUMNS: Column<StockListItem>[] = [
  {
    key: "symbol",
    header: "Symbol",
    width: "8%",
    sortKey: "symbol",
    mobileRole: "title",
    render: (s) => s.symbol,
  },
  {
    key: "company",
    header: "Company",
    mobileRole: "subtitle",
    // One line per row: a full name ("Abbott Laboratories (Pakistan) Limited") wraps to a second
    // line, and one wrapped cell sets the height of every row in the table — measured 49.4px against
    // the 34.2px of a row that fits. `noWrap` clips the cell and the full name stays one hover away.
    // No `width`: this is the column that takes what the rationed ones leave (see `fixed` below).
    noWrap: true,
    render: (s) => (
      <Typography variant="body2" title={s.companyName ?? undefined}>
        {s.companyName ?? DASH}
      </Typography>
    ),
  },
  {
    key: "points",
    // The caveat lives on the header, because this column mixes two indices and must not be read as
    // one scale: a KSE-100 member's contribution is measured against a ~168,600-point index, and
    // everything else against the ~102,100-point market index (ALLSHR). The cell names its own index
    // for the same reason, so a figure is never read without knowing what it moved.
    header: (
      <span title="Index points this stock contributed: to the KSE-100 for its members, to the ALLSHR market index for everything else">
        Points
      </span>
    ),
    align: "right",
    width: "7%",
    // Deliberately not sortable. The server has no sort field for a figure that is overwritten every
    // couple of minutes, and an order across two different indices would not mean anything anyway.
    mobileRole: "meta",
    render: (s) => (
      <Typography
        variant="body2"
        title={
          s.pointsIndex
            ? `Contribution to the ${INDEX_LABELS[s.pointsIndex] ?? s.pointsIndex}`
            : undefined
        }
        // Direction is carried by the sign as well as the colour: colour alone never says it here.
        sx={{
          color:
            s.points == null
              ? 'text.secondary'
              : s.points > 0
                ? 'up.main'
                : s.points < 0
                  ? 'down.main'
                  : 'text.secondary',
        }}
      >
        {formatSigned(s.points)}
      </Typography>
    ),
  },
  {
    key: "sector",
    header: "Sector",
    // The longest sector is 40 characters of upper case ("INV. BANKS / INV. COS. / SECURITIES
    // COS."), which is more than this column can hold beside the ten others — so it clips with an
    // ellipsis and the full text stays one hover away, rather than wrapping and doubling the row.
    // Narrowed from 15% when Points arrived: it was already the most clipped column, so the eleven
    // columns still leave the Company column what it had (measured 252px).
    width: "10%",
    mobileRole: "meta",
    render: (s) => (
      <Typography variant="body2" noWrap title={s.sector ?? undefined}>
        {s.sector ?? DASH}
      </Typography>
    ),
  },
  {
    key: "price",
    header: "Price",
    align: "right",
    width: "6.8%",
    sortKey: "price",
    mobileRole: "meta",
    render: (s) => formatNumber(s.currentPrice),
  },
  {
    key: "change",
    header: "Change",
    align: "right",
    width: "8.1%",
    sortKey: "changePercent",
    mobileRole: "value",
    render: (s) => (
      <ChangePill
        value={s.changePercent}
        // Tinted rather than solid: twenty filled red pills in one column shout, and the sign plus
        // the glyph already carry the direction.
        variant="soft"
        title={s.change != null ? `${s.change > 0 ? "+" : ""}${s.change}` : undefined}
      />
    ),
  },
  {
    key: "volume",
    header: "Volume",
    align: "right",
    width: "8%",
    sortKey: "volume",
    mobileRole: "meta",
    render: (s) => formatCount(s.volume),
  },
  {
    key: "marketCap",
    header: "Mkt cap",
    align: "right",
    width: "8.1%",
    sortKey: "marketCap",
    mobileRole: "meta",
    render: (s) => {
      const abbreviated = formatMarketCap(s.marketCap);
      if (!abbreviated) return DASH;
      // The unabbreviated figure stays one hover away.
      return <span title={formatRupees(s.marketCap as number)}>{abbreviated}</span>;
    },
  },
  {
    key: "week52Low",
    header: "52W low",
    align: "right",
    // The header labels are `nowrap` (theme), so a column narrower than its own label pushes the
    // table past the container and puts a scrollbar under it — these three carry their labels.
    width: "7.7%",
    sortKey: "week52Low",
    // Shown on a phone too: the row-wise layout is the design at every width here, so no column is
    // rationed away — the table keeps its own scroll instead.
    mobileRole: "meta",
    render: (s) => formatNumber(s.week52Low),
  },
  {
    key: "week52High",
    header: "52W high",
    align: "right",
    width: "8%",
    sortKey: "week52High",
    mobileRole: "meta",
    render: (s) => formatNumber(s.week52High),
  },
  {
    key: "lastSyncedAt",
    header: "Last synced",
    width: "7.6%",
    mobileRole: "meta",
    render: (s) =>
      s.lastSyncedAt ? (
        <span title={formatDateTime(s.lastSyncedAt)}>{formatRelative(s.lastSyncedAt)}</span>
      ) : (
        "never"
      ),
  },
];
/**
 * How many rows each list is read in. The index's members fit on a single page (the exchange publishes
 * 99 of them, and the API's `limit` ceiling is 200), while the rest of the universe — everything
 * tracked, 508 symbols — is read 50 at a time. Same split the API's `group` parameter documents.
 */
/** The two lists the switch offers: the index's members, or everything tracked. */
type Universe = "kse100" | "all";
const PAGE_SIZE: Record<Universe, number> = { kse100: 100, all: 50 };

export function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notify } = useToast();
  const addStock = useAddStock();
  const syncAll = useSyncAll();

  const [addOpen, setAddOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [confirmSyncAll, setConfirmSyncAll] = useState(false);
  const [justTriggered, setJustTriggered] = useState(false);
  const [slowSort, setSlowSort] = useState(false);
  // The universe worker (#41) puts every listed security on this dashboard, so the table is
  // paged rather than cut off at the first N symbols.
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE.kse100);
  // Which list the table shows, and the only thing the `group` parameter is asked for. The API
  // filters, so the rows, the count and the pager all belong to the chosen list: the arrows walk the
  // KSE-100's members and never step out of them. KSE-100 is the default — it is the list a reader
  // opens the board for, and the rest of the universe is one click away.
  const [universe, setUniverse] = useState<Universe>("kse100");
  const group: StockListGroup | undefined = universe === "all" ? undefined : universe;
  const [sort, setSort] = useState<{ key: StockSortField; direction: SortOrder }>({
    key: "symbol",
    direction: "asc",
  });

  // Poll queue status continuously; also while a "sync all" just fired so the active/waiting
  // counts (and the progress bar) reflect the fan-out in real time.
  const { data: status } = useSyncStatus(true);
  const syncCounts = status?.queues["stock-sync"];
  const inFlightCount = syncCounts?.active ?? 0;
  const queuedCount = (syncCounts?.waiting ?? 0) + (syncCounts?.delayed ?? 0);
  // Failures across every queue, not just this one. The single-queue number was also BullMQ's
  // *set size*, which counts entries whose job has already been trimmed away — see FailuresPanel.
  const failedCount = Object.values(status?.queues ?? {}).reduce((n, counts) => n + (counts.failed ?? 0), 0);
  const syncingAll = justTriggered || inFlightCount > 0 || queuedCount > 0;

  // The index board: PSX's own indices, scraped from the exchange's market-summary page. It was
  // mounted on this dashboard by 51f1aaa and lost when the dashboard was rewritten — `useIndices`
  // and the panel had no callers at all, so nothing rendered them.
  const { data: indexBoard, isLoading: indicesLoading, isError: indicesError } = useIndices(syncingAll);

  // Keep the stock table itself fresh (prices, last-synced) while a sync is running.
  const { data, isLoading, isError, refetch } = useStocks(
    page + 1,
    rowsPerPage,
    syncingAll,
    sort.key,
    sort.direction,
    group,
  );

  // Three places count the *universe* rather than the list: the page header, the "Tracked stocks"
  // tile, and the sync-all question (which syncs every tracked symbol, whatever the table shows).
  // A scoped request reports both group sizes, so they sum to the universe without a second request
  // — `data.total` is the scoped count, and it belongs to the pager alone.
  const universeCount = data?.groups ? data.groups.kse100 + data.groups.rest : data?.total;

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
      qc.invalidateQueries({ queryKey: ["stocks"] });
      notify({ message: "Sync complete — all stocks are up to date." });
    }
    wasSyncing.current = syncingAll;
  }, [syncingAll, qc, notify]);

  // A heavy sort (volume, market cap, 52-week range) takes the API ~20s — issue #96. Rather than a
  // skeleton that looks frozen, say what is happening once it is clearly not instant.
  useEffect(() => {
    if (!isLoading) {
      setSlowSort(false);
      return;
    }
    const t = setTimeout(() => setSlowSort(true), 3000);
    return () => clearTimeout(t);
  }, [isLoading]);

  const newestReading = useMemo(() => {
    const stamps = (data?.items ?? [])
      .map((s) => s.lastSyncedAt)
      .filter((v): v is string => Boolean(v))
      .map((v) => new Date(v).getTime())
      .filter((n) => Number.isFinite(n));
    return stamps.length > 0 ? new Date(Math.max(...stamps)) : null;
  }, [data]);

  const submit = () => {
    const s = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(s)) return;
    addStock.mutate(s, {
      onSuccess: () => {
        setAddOpen(false);
        setSymbol("");
        notify({ message: `Added ${s} — scraping has started.` });
      },
    });
  };

  const chooseUniverse = (next: Universe | null) => {
    if (!next || next === universe) return;
    setUniverse(next);
    // Each list is read at its own page size, and both go back to page one: page 4 of the whole
    // universe has no counterpart in the KSE-100, and the pager must never show a page that belongs
    // to the list you just left.
    setRowsPerPage(PAGE_SIZE[next]);
    setPage(0);
  };

  const runSyncAll = () => {
    setConfirmSyncAll(false);
    syncAll.mutate(undefined, {
      onSuccess: () => {
        setJustTriggered(true);
        notify({ message: "Sync started for all tracked stocks." });
      },
      onError: () => notify({ message: "Failed to start the sync — please try again.", severity: "error" }),
    });
  };

  const pager = (
    <Box>
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        {/* 250 was offered here and could never work: the API caps `limit` at 200 and answers 400. */}
        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={page}
          onPageChange={(_e, next) => setPage(next)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100, 200]}
        />
      </Box>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
        sx={{ display: { xs: "flex", md: "none" }, p: 1.5 }}
      >
        <Button size="small" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
          Previous
        </Button>
        <Typography variant="caption" color="text.secondary">
          Page {page + 1} of {Math.max(1, data?.totalPages ?? 1)}
        </Typography>
        <Button
          size="small"
          onClick={() => setPage((p) => p + 1)}
          disabled={page + 1 >= (data?.totalPages ?? 1)}
        >
          Next
        </Button>
      </Stack>
    </Box>
  );

  return (
    <Box>
      <PageHeader
        title="Market board"
        subtitle={`${formatCount(universeCount)} tracked securities${
          newestReading ? ` · newest reading ${formatRelative(newestReading)}` : ""
        }`}
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<SyncIcon />}
              disabled={syncingAll || syncAll.isPending}
              onClick={() => setConfirmSyncAll(true)}
            >
              {syncingAll ? "Syncing…" : "Sync all"}
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
              Add stock
            </Button>
          </>
        }
      />

      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
          mb: 2.5,
        }}
      >
        <StatTile
          label="Tracked stocks"
          value={formatCount(universeCount)}
          footer={
            <Typography variant="caption" color="text.secondary">
              {data ? `${data.items.length} on this page` : "loading…"}
            </Typography>
          }
        />
        <StatTile
          label="Active syncs"
          value={formatCount(inFlightCount)}
          footer={
            <Typography variant="caption" color="text.secondary">
              {syncingAll ? "syncing now" : "idle"}
            </Typography>
          }
        />
        <StatTile
          label="Waiting"
          value={formatCount(queuedCount)}
          footer={
            <Typography variant="caption" color="text.secondary">
              queued plus delayed
            </Typography>
          }
        />
        <StatTile
          label="Failed"
          value={formatCount(failedCount)}
          tone={failedCount > 0 ? "down" : "muted"}
          footer={
            <Typography variant="caption" color="text.secondary">
              {failedCount > 0 ? "see Failed jobs below" : "none"}
            </Typography>
          }
        />
      </Box>

      {syncingAll && (
        <Box sx={{ mb: 2.5 }}>
          <LinearProgress />
          <Typography variant="caption" color="text.secondary">
            Syncing all tracked stocks — {inFlightCount} active, {queuedCount} waiting. This page
            updates automatically.
          </Typography>
        </Box>
      )}

      <IndicesPanel indices={indexBoard?.items} isLoading={indicesLoading} isError={indicesError} />

      <FailuresPanel status={status} />

      <SectionCard
        title="Tracked securities"
        subtitle={
          universe === "kse100"
            ? "The KSE-100's members. Click a column to sort them on the server"
            : "Everything tracked. Click a column to sort it on the server"
        }
        action={
          // Two lists, one table: the switch says which one the rows below belong to, and the pager
          // counts only that one. `exclusive` keeps a single choice, and the group is what pages.
          <ToggleButtonGroup
            size="small"
            exclusive
            value={universe}
            onChange={(_e, next) => chooseUniverse(next)}
            aria-label="Which stocks the table lists"
          >
            <ToggleButton value="kse100">KSE-100</ToggleButton>
            <ToggleButton value="all">All stocks</ToggleButton>
          </ToggleButtonGroup>
        }
        flush
      >
        <DataTable
          columns={COLUMNS}
          rows={data?.items ?? []}
          ariaLabel="Tracked securities"
          /* Row-wise at every width, as asked: a phone gets the same rows as a desktop rather than
           * the card list, so the table carries a floor and its container takes the scroll. */
          cardsBelow="never"
          minTableWidth={1024}
          /* Rationed widths: nine columns carry a share and Company takes the rest, so one long
           * name or sector clips instead of wrapping and setting the height of every row. */
          fixed
          rowKey={(s) => s.id}
          rowHref={(s) => `/stocks/${s.symbol}`}
          onRowClick={(s) => navigate(`/stocks/${s.symbol}`)}
          loading={isLoading}
          error={isError ? "Failed to load the stock list." : undefined}
          onRetry={() => void refetch()}
          sort={{ key: sort.key, direction: sort.direction }}
          onSortChange={(next) => {
            setSort({ key: next.key as StockSortField, direction: next.direction });
            setPage(0);
          }}
          emptyTitle={
            universe === "kse100" ? "No KSE-100 members tracked" : "No stocks tracked yet"
          }
          emptyDescription={
            universe === "kse100"
              ? "The index's published member list is refreshed daily, and nothing in it is tracked here yet. Everything tracked is under All stocks."
              : "Add a symbol to start collecting prices for it."
          }
          emptyAction={
            universe === "kse100" ? (
              <Button variant="outlined" onClick={() => chooseUniverse("all")}>
                Show all stocks
              </Button>
            ) : (
              <Button variant="contained" onClick={() => setAddOpen(true)}>
                Add stock
              </Button>
            )
          }
          pagination={pager}
          skeletonRows={8}
          toolbar={
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: "wrap" }}>
              <Typography variant="caption" color="text.secondary">
                Sorted by {sort.key} ({sort.direction === "asc" ? "ascending" : "descending"})
              </Typography>
              {slowSort && (
                <Typography variant="caption" color="warning.main">
                  · still sorting — heavy sorts take up to ~20 seconds (issue #96)
                </Typography>
              )}
            </Stack>
          }
        />
      </SectionCard>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add a stock</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="PSX symbol"
            placeholder="FFC"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            helperText="The exchange symbol, 1–12 letters or digits."
            inputProps={{ style: { textTransform: "uppercase" } }}
          />
          {addStock.isError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(addStock.error as unknown as ApiError)?.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={addStock.isPending || !/^[A-Z0-9]{1,12}$/.test(symbol.trim().toUpperCase())}
          >
            {addStock.isPending ? "Adding…" : "Add & scrape"}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmSyncAll}
        title="Sync all tracked stocks?"
        message={`This fetches the latest data for all ${formatCount(universeCount)} tracked stocks from PSX and Sarmaaya. It runs in the background — you can keep using the dashboard while it completes.`}
        confirmLabel="Sync all"
        pending={syncAll.isPending}
        pendingLabel="Starting…"
        onConfirm={runSyncAll}
        onClose={() => setConfirmSyncAll(false)}
      />
    </Box>
  );
}
