-- The Sync Logs page runs two query shapes that scan the whole sync_logs table
-- (233,000 rows at the time of writing) because neither column they filter/order on has an index:
--
--   1. Filtered by symbol:   WHERE symbol = 'LUCK' ORDER BY started_at DESC LIMIT 20
--      -> Parallel Seq Scan + top-N sort, ~96-268 ms (268 ms when a status filter is added,
--         because the existing status index narrows to "SUCCESS" but then has to filter the whole
--         status group for the symbol).
--   2. Unfiltered recent:     ORDER BY started_at DESC LIMIT 20
--      -> Parallel Seq Scan + top-N sort, ~159 ms.
--
-- The status-filtered shape already has sync_logs_status_started_at_idx, and the dashboard's
-- per-symbol LATERAL lookup has sync_logs_stock_id_started_at_idx. These two indexes cover the
-- remaining columns the page actually filters and orders on:
--
--   - (symbol, started_at DESC) serves the symbol-filtered view (with or without a status filter:
--     the status filter runs over one symbol's ~440 rows, which is cheap), and
--   - (started_at DESC) serves the unfiltered "recent syncs" view.
--
-- `symbol` is nullable; NULLs sort last in a DESC btree, which is harmless because the
-- symbol-filtered query only ever matches one non-null symbol.
--
-- CREATE INDEX CONCURRENTLY is not used: PostgreSQL forbids it inside a transaction, and
-- `prisma migrate deploy` applies each migration inside one. The build is sub-second on 233k rows
-- (the repo already accepted a ~0.6s non-concurrent build on the 1.1M-row stock_prices table in
-- migration 0013), so the write lock is negligible.
CREATE INDEX IF NOT EXISTS sync_logs_symbol_started_at_idx
  ON sync_logs (symbol, started_at DESC);

CREATE INDEX IF NOT EXISTS sync_logs_started_at_idx
  ON sync_logs (started_at DESC);
