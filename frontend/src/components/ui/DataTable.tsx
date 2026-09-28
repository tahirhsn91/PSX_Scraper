import { ReactNode } from 'react';
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
import { Link as RouterLink } from 'react-router-dom';
import { ErrorPanel, StatePanel } from './StatePanel';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Present when the server can sort by this column (enables the sortable header). */
  sortKey?: string;
  width?: number | string;
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
  /** Row destination: rendered as a real link in the first cell, so rows are keyboard reachable. */
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
  /** Let long tables scroll inside the card instead of stretching the page. */
  maxHeight?: number | string;
  /** Extra content above the rows, rendered inside the card body. */
  toolbar?: ReactNode;
  /** Whole-row click on desktop, for parity with the card list. The row link stays for keyboards. */
  onRowClick?: (row: T) => void;
  /** Stacked cards below this breakpoint. Defaults to `md`. */
  cardsBelow?: 'sm' | 'md';
}

/**
 * The one data table.
 *
 * On `md` and up it is a dense table with a sticky header and sortable columns; below that it
 * becomes a card list, because a nine-column table cannot be read on a phone (the audit measured
 * the dashboard's table at 806px inside a 390px viewport, which scrolled the whole page sideways).
 * Horizontal scrolling is confined to the table container — never the page.
 */
export function DataTable<T>({
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
}: DataTableProps<T>) {
  const theme = useTheme();
  const isCardView = useMediaQuery(theme.breakpoints.down(cardsBelow));

  /** Columns hidden below a breakpoint stop taking part in the layout at that width. */
  const cellSx = (c: Column<T>) =>
    c.hideBelow
      ? { display: { xs: 'none', sm: c.hideBelow === 'sm' ? 'table-cell' : 'none', md: 'table-cell' } }
      : undefined;

  /**
   * The header row, shared by the loading and the loaded states — so a sort the reader just clicked
   * stays visible (and announced) while the new page is in flight, instead of the table turning
   * into an unlabelled skeleton with no sort state.
   */
  const headRow = () => (
    <TableHead>
      <TableRow>
        {columns.map((c) => {
          const sorted = Boolean(sort && c.sortKey && sort.key === c.sortKey);
          const canSort = Boolean(c.sortKey && onSortChange);
          return (
            <TableCell
              key={c.key}
              align={c.align}
              width={c.width}
              aria-sort={sorted ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
              sx={cellSx(c)}
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
          <Table size="small" aria-busy="true" aria-label={ariaLabel ?? 'Results'}>
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
        sx={stale ? { opacity: 0.55, pointerEvents: 'none', transition: 'opacity 150ms' } : undefined}
        aria-busy={stale || undefined}
      >
        <MobileCards columns={columns} rows={rows} rowKey={rowKey} rowHref={rowHref} />
      </Box>
    ) : (
      <TableContainer sx={{ maxHeight }}>
        <Table size="small" stickyHeader={Boolean(maxHeight)} aria-label={ariaLabel ?? 'Results'} aria-busy={stale || undefined}>
          {headRow()}
          <TableBody sx={stale ? { opacity: 0.55, transition: 'opacity 150ms' } : undefined}>
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <TableRow
                  key={rowKey(row)}
                  hover
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  sx={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {columns.map((c, index) => (
                    <TableCell
                      key={c.key}
                      align={c.align}
                      sx={
                        c.hideBelow
                          ? { display: { xs: 'none', sm: c.hideBelow === 'sm' ? 'table-cell' : 'none', md: 'table-cell' } }
                          : undefined
                      }
                    >
                      {index === 0 && href ? (
                        <MuiLink component={RouterLink} to={href} sx={{ fontWeight: 600, color: 'inherit' }}>
                          {c.render(row)}
                        </MuiLink>
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

function MobileCards<T>({
  columns,
  rows,
  rowKey,
  rowHref,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
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
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                {titleCol.render(row)}
              </Typography>
              {subtitleCol && (
                <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {subtitleCol.render(row)}
                </Typography>
              )}
              {metaCols.length > 0 && (
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ mt: 0.5, flexWrap: 'wrap' }}>
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
