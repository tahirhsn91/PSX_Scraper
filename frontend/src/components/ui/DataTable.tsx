import { memo, type MouseEvent, type ReactNode } from 'react';
import {
  Box,
  Card,
  CardActionArea,
  Link as MuiLink,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { ErrorPanel, StatePanel } from './StatePanel';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Present when the server can sort by this column (enables the sortable header). */
  sortKey?: string;
  width?: number | string;
  /**
   * Keep this cell on one line: `white-space: nowrap` with `overflow: hidden`, so text too long for
   * the column is clipped with an ellipsis instead of wrapping.
   *
   * A wrapped cell sets the height of its whole row — one long company name made every row 49.4px
   * against the 34.2px of a row that fits. Pair it with `fixed` on the table and a `title` (or
   * `aria-label`) on the content, so the clipped value is still reachable.
   *
   * Table only: the mobile card list renders `render(row)` in its own layout, so a phone still shows
   * the full value on as many lines as it needs.
   */
  noWrap?: boolean;
  /** Hide this column below the given breakpoint. */
  hideBelow?: 'sm' | 'md';
  /**
   * How the column appears in the mobile card list: `title`, `subtitle`, `value` (right-hand,
   * emphasised), `meta` (small detail line), or `hidden`.
   */
  mobileRole?: 'title' | 'subtitle' | 'value' | 'meta' | 'hidden';
}

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name for the table — "Results" tells a screen-reader user nothing. */
  ariaLabel?: string;
  /**
   * Row destination. The first cell renders a real link (keyboard, middle-click, "open in new
   * tab") and the rest of the row navigates on click, so aiming at the company name or the price
   * opens the same page. Below the card breakpoint the whole card is the link.
   */
  rowHref?: (row: T) => string;
  loading?: boolean;
  /** Error message; renders the error state instead of rows. */
  error?: ReactNode;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  sort?: SortState | null;
  onSortChange?: (next: SortState) => void;
  /** Server-side pagination controls (rendered under the table, outside its scroll area). */
  pagination?: ReactNode;
  skeletonRows?: number;
  /**
   * Caps the container's height and thereby makes the table its own vertical scroll box —
   * `stickyHeader` follows it, and MUI's `TableContainer` is `overflow: auto`.
   *
   * Pass this only where an inner scroller is the intended interaction. A mouse wheel over such a
   * box scrolls *the box*, not the page, which reads as "the page will not scroll" — and a
   * trackpad's finer gesture moves the box enough to hide the cause, so the two inputs disagree.
   * When the page should scroll, leave this unset: the table keeps its horizontal scroll and
   * pagination keeps it short.
   */
  maxHeight?: number | string;
  /** Extra content above the rows, rendered inside the card body. */
  toolbar?: ReactNode;
  /** Whole-row click on desktop, for parity with the card list. The row link stays for keyboards. */
  onRowClick?: (row: T) => void;
  /**
   * Stacked cards below this breakpoint. Defaults to `md`.
   *
   * `'never'` keeps the table at every width, which is what a caller wants when the row-wise layout
   * *is* the design and a phone should get the same rows as a desktop rather than a card list. The
   * caller then owns the horizontal scroll: give the table a `minTableWidth` so the columns stay
   * legible and the scroll stays inside the table's container.
   */
  cardsBelow?: 'sm' | 'md' | 'never';
  /**
   * `table-layout: fixed`, so the column widths are the ones the page asked for instead of whatever
   * the content demands.
   *
   * Auto layout sizes a column by its longest cell, so one long company name — or one long sector —
   * wraps to a second line and every row in the table grows with it (measured: 49.4px against the
   * 34.2px of a row that fits). With fixed layout the widths below hold, cells that are set `noWrap`
   * clip with an ellipsis instead of wrapping, and every row is one line tall.
   *
   * Prefer percentage widths with this, and leave one column unsized: it takes what is left, so the
   * table still fits a narrower desktop window instead of scrolling sideways.
   */
  fixed?: boolean;
  /**
   * A floor for the table's own width, in CSS pixels.
   *
   * With `fixed` the column widths are proportional, so a narrow viewport would squeeze every column
   * down to a few characters. This keeps them legible and hands the overflow to the table's
   * container — the table scrolls, the page never does. Pair it with `cardsBelow="never"`.
   */
  minTableWidth?: number;
  /**
   * Keeps the first column pinned while the table scrolls sideways on a phone.
   *
   * `cardsBelow="never"` is a deliberate choice on the dashboard — the phone gets the same rows as
   * the desktop — but without a pinned symbol a reader who swipes right to reach Price no longer
   * knows which row they are reading. Pinned on xs only; desktop is unchanged.
   */
  stickyFirstColumn?: boolean;
  /**
   * Optional mark rendered beside the first column — the Shariah badge sits to the right of every
   * ticker. A render prop rather than a boolean so DataTable stays generic: the page decides what
   * the mark is, the table only decides where it goes.
   */
  rowBadge?: (row: T) => ReactNode;
  /**
   * Changes whenever the rows on screen represent a different question — a new sort, a new page,
   * the other index's member list. The body then fades and lifts 4px into place (160ms) instead
   * of swapping rows under the reader with no transition at all.
   *
   * Deliberately a string rather than derived from `rows`: polling replaces the row objects every
   * few seconds, and an animation keyed on those would replay on every poll. Only the caller knows
   * which change was a *question*, so only the caller can name it.
   */
  transitionKey?: string;
}

/**
 * The one data table.
 *
 * On `md` and up it is a dense table with a sticky header and sortable columns; below that it
 * becomes a card list, because a nine-column table cannot be read on a phone (the audit measured
 * the dashboard's table at 806px inside a 390px viewport, which scrolled the whole page sideways).
 * Horizontal scrolling is confined to the table container — never the page.
 */
function DataTableInner<T>({
  columns,
  rows,
  rowKey,
  ariaLabel,
  rowHref,
  loading = false,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyAction,
  sort,
  onSortChange,
  pagination,
  skeletonRows = 6,
  maxHeight,
  toolbar,
  onRowClick,
  cardsBelow = 'md',
  fixed = false,
  minTableWidth,
  stickyFirstColumn = false,
  rowBadge,
  transitionKey,
}: DataTableProps<T>) {
  const theme = useTheme();
  const navigate = useNavigate();
  // `'never'` is not a breakpoint: it means no width renders the card list at all.
  const cardQuery = useMediaQuery(theme.breakpoints.down(cardsBelow === 'never' ? 'sm' : cardsBelow));
  const isCardView = cardsBelow === 'never' ? false : cardQuery;

  /** Column widths stay the page's own, and a floor keeps them legible when the container is narrow. */
  const tableSx = {
    ...(fixed ? { tableLayout: 'fixed' as const } : {}),
    ...(minTableWidth ? { minWidth: minTableWidth } : {}),
  };

  /** Columns hidden below a breakpoint stop taking part in the layout at that width. */
  const cellSx = (c: Column<T>, index: number) => ({
    ...(c.hideBelow
      ? { display: { xs: 'none', sm: c.hideBelow === 'sm' ? 'table-cell' : 'none', md: 'table-cell' } }
      : {}),
    ...(stickyFirstColumn && index === 0
      ? {
          position: { xs: 'sticky', md: 'static' },
          left: 0,
          zIndex: { xs: 2, md: 'auto' },
          backgroundColor: 'background.paper',
          // A hairline shadow is the only cue that the table continues to the right.
          boxShadow: { xs: '6px 0 8px -8px rgba(0,0,0,0.45)', md: 'none' },
        }
      : {}),
  });

  /**
   * The header row, shared by the loading and the loaded states — so a sort the reader just clicked
   * stays visible (and announced) while the new page is in flight, instead of the table turning
   * into an unlabelled skeleton with no sort state.
   */
  const headRow = () => (
    <TableHead>
      <TableRow>
        {columns.map((c, index) => {
          const sorted = Boolean(sort && c.sortKey && sort.key === c.sortKey);
          const canSort = Boolean(c.sortKey && onSortChange);
          return (
            <TableCell
              key={c.key}
              align={c.align}
              width={c.width}
              aria-sort={sorted ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
              sx={{ ...cellSx(c, index), ...(stickyFirstColumn && index === 0 ? { zIndex: { xs: 3, md: 'auto' } } : {}) }}
            >
              {canSort ? (
                <TableSortLabel
                  active={sorted}
                  direction={sorted ? sort?.direction : 'asc'}
                  onClick={() =>
                    onSortChange?.({
                      key: c.sortKey as string,
                      direction: sorted && sort?.direction === 'asc' ? 'desc' : 'asc',
                    })
                  }
                  sx={{ '& .MuiTableSortLabel-icon': { opacity: sorted ? 1 : 0.3 } }}
                >
                  {c.header}
                </TableSortLabel>
              ) : (
                c.header
              )}
            </TableCell>
          );
        })}
      </TableRow>
    </TableHead>
  );

  const body = () => {
    if (error) return <ErrorPanel message={error} onRetry={onRetry} compact />;
    // First load for this query (no rows yet): skeleton rows underneath the real header.
    if (loading && rows.length === 0) {
      return isCardView ? (
        <Stack spacing={1} sx={{ p: 1.5 }}>
          {Array.from({ length: Math.min(skeletonRows, 5) }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={72} />
          ))}
        </Stack>
      ) : (
        <TableContainer>
          <Table size="small" aria-busy="true" aria-label={ariaLabel ?? 'Results'} sx={tableSx}>
            {headRow()}
            <TableBody>
              {Array.from({ length: skeletonRows }).map((_, r) => (
                <TableRow key={r}>
                  {columns.map((c) => (
                    <TableCell key={c.key} align={c.align}>
                      <Skeleton variant="text" width={c.align === 'right' ? 56 : undefined} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      );
    }
    if (rows.length === 0) {
      return (
        <StatePanel
          kind="empty"
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          compact
        />
      );
    }
    // Refetching while rows are already on screen: keep them and dim them, never blank the table.
    const stale = loading;
    return isCardView ? (
      <Box
        key={transitionKey ?? 'cards'}
        sx={{
          ...(stale ? { opacity: 0.55, pointerEvents: 'none', transition: 'opacity 150ms' } : {}),
          ...(transitionKey
            ? {
                animation: `rows-in 160ms ${theme.app.motion.easing}`,
                '@keyframes rows-in': {
                  from: { opacity: 0.55, transform: 'translateY(4px)' },
                  to: { opacity: 1, transform: 'none' },
                },
              }
            : {}),
        }}
        aria-busy={stale || undefined}
      >
        <MobileCards columns={columns} rows={rows} rowKey={rowKey} rowHref={rowHref} rowBadge={rowBadge} />
      </Box>
    ) : (
      <TableContainer sx={{ maxHeight }}>
        <Table
          size="small"
          stickyHeader={Boolean(maxHeight)}
          aria-label={ariaLabel ?? 'Results'}
          aria-busy={stale || undefined}
          sx={tableSx}
        >
          {headRow()}
          <TableBody
            key={transitionKey ?? 'rows'}
            sx={{
              ...(stale ? { opacity: 0.55, transition: 'opacity 150ms' } : {}),
              ...(transitionKey
                ? {
                    animation: `rows-in 160ms ${theme.app.motion.easing}`,
                    '@keyframes rows-in': {
                      from: { opacity: 0.55, transform: 'translateY(4px)' },
                      to: { opacity: 1, transform: 'none' },
                    },
                  }
                : {}),
            }}
          >
            {rows.map((row) => {
              const href = rowHref?.(row);
              // A row with a destination is clickable anywhere on it. The first-cell link stays for
              // keyboards and middle-click; this handler covers the obvious human move — aiming at
              // the company name, the change pill or the price.
              const followRow = href
                ? (event: MouseEvent<HTMLTableRowElement>) => {
                    // A cell may hold its own control (that link, a button). Let it win, so the
                    // click never becomes two navigations.
                    if ((event.target as HTMLElement).closest('a, button, input, select, textarea, [role="button"]')) return;
                    // Leave modified clicks alone: the browser opens a new tab, the app does not.
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    // Finishing a text selection is not a click on the row.
                    if ((window.getSelection()?.toString() ?? '') !== '') return;
                    navigate(href);
                  }
                : undefined;
              return (
                <TableRow
                  key={rowKey(row)}
                  hover
                  onClick={onRowClick ? () => onRowClick(row) : followRow}
                  sx={onRowClick || href ? { cursor: 'pointer' } : undefined}
                >
                  {columns.map((c, index) => (
                    <TableCell
                      key={c.key}
                      align={c.align}
                      sx={{
                        ...cellSx(c, index),
                        ...(c.noWrap ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
                      }}
                    >
                      {index === 0 ? (
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                          {href ? (
                            <MuiLink component={RouterLink} to={href} sx={{ fontWeight: 600, color: 'inherit' }}>
                              {c.render(row)}
                            </MuiLink>
                          ) : (
                            c.render(row)
                          )}
                          {rowBadge?.(row)}
                        </Stack>
                      ) : (
                        c.render(row)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <Box>
      {toolbar && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ p: 1.5, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}
        >
          {toolbar}
        </Stack>
      )}
      {body()}
      {pagination && <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>{pagination}</Box>}
    </Box>
  );
}

/**
 * Memoised, so a parent's unrelated re-render does not redraw every cell.
 *
 * The dashboard re-renders on its 3-second sync-status poll, and the table under it is ~100 rows ×
 * 9 columns ≈ 900 cells: a queue counter ticking over rebuilt the whole grid. With `memo`, this
 * component's own props become the only reason it redraws — which holds only as long as the caller
 * keeps them referentially stable. `Dashboard.tsx` does: its handlers are `useCallback`ed and the
 * JSX it passes as `toolbar` / `pagination` / `emptyAction` is `useMemo`ed for exactly this reason.
 * A caller that passes fresh inline arrows simply opts out of the optimisation, and behaves as it
 * did before.
 *
 * The cast restores the generic signature: `memo()` erases the type parameter, and callers render it
 * as `DataTable<Row>`.
 */
export const DataTable = memo(DataTableInner) as typeof DataTableInner;

function MobileCards<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  rowBadge,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  rowBadge?: (row: T) => ReactNode;
}) {
  const titleCol = columns.find((c) => c.mobileRole === 'title') ?? columns[0];
  const subtitleCol = columns.find((c) => c.mobileRole === 'subtitle');
  const valueCol = columns.find((c) => c.mobileRole === 'value');
  const metaCols = columns.filter((c) => c.mobileRole === 'meta');

  return (
    <Stack spacing={1} sx={{ p: 1.5 }}>
      {rows.map((row) => {
        const href = rowHref?.(row);
        const inner = (
          <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              {/* `component="div"`, not the default <h6>: most title columns render their own
                  Typography, and an <h6> wrapping a <p> is invalid nesting that browsers repair in
                  unpredictable ways. The child is flattened back to the card title's own type. */}
              <Typography
                variant="subtitle1"
                component="div"
                sx={{
                  fontWeight: 600,
                  // Flex, because a title column renders its own block-level <p>: with plain inline
                  // flow the badge dropped to a line of its own under the ticker.
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  '& > *': { m: 0, fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit' },
                }}
              >
                {titleCol.render(row)}
                {rowBadge?.(row)}
              </Typography>
              {subtitleCol && (
                // Two lines, not one clipped line: a company name cut mid-word ("Pervez Ahmed
                // Consultancy Serv…") reads as missing data. Clamped so a pathological name cannot
                // push the figures off the card.
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    // Column renderers are written for table cells and several return their own
                    // <Typography noWrap>. As a block child that nowrap defeats the clamp, so the
                    // name was cut after one line; inlined, the text belongs to the clamp again and
                    // ellipsises on the second line.
                    '& > *': {
                      display: 'inline',
                      m: 0,
                      // `noWrap` ships its own class, so the inherited override needs the flag.
                      whiteSpace: 'normal !important',
                      overflow: 'visible',
                      textOverflow: 'clip',
                      fontSize: 'inherit',
                      fontWeight: 'inherit',
                      color: 'inherit',
                      lineHeight: 'inherit',
                    },
                  }}
                >
                  {subtitleCol.render(row)}
                </Typography>
              )}
              {metaCols.length > 0 && (
                <Stack direction="row" sx={{ mt: 0.5, flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5 }}>
                  {metaCols.map((c) => (
                    <Stack key={c.key} direction="row" spacing={0.5} alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        {c.header}
                      </Typography>
                      <Typography variant="caption">{c.render(row)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
            {valueCol && <Box sx={{ flexShrink: 0 }}>{valueCol.render(row)}</Box>}
          </Stack>
        );
        return (
          <Card key={rowKey(row)} variant="outlined">
            {href ? (
              <CardActionArea component={RouterLink} to={href} sx={{ p: 1.25 }}>
                {inner}
              </CardActionArea>
            ) : (
              <Box sx={{ p: 1.25 }}>{inner}</Box>
            )}
          </Card>
        );
      })}
    </Stack>
  );
}
