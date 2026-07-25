-- Idempotent repair migration.
--
-- Production (Neon) is throwing Postgres error 42P10 ("there is no unique or
-- exclusion constraint matching the ON CONFLICT specification") on
-- `prisma.stock.upsert()`, even though `_prisma_migrations` shows 0001_init as
-- applied and that migration does create `stocks_symbol_key`. The live table
-- is missing the index anyway — most likely it was created against Neon via
-- `prisma db push` (or similar) before `migrate deploy` took over, so the
-- migration history was baselined as "applied" without the DDL actually
-- running. `CREATE UNIQUE INDEX IF NOT EXISTS` re-asserts every unique index
-- Prisma's schema declares; it's a no-op wherever the index already exists.
CREATE UNIQUE INDEX IF NOT EXISTS "stocks_symbol_key" ON "stocks"("symbol");
CREATE UNIQUE INDEX IF NOT EXISTS "stock_prices_stock_id_last_trade_date_key" ON "stock_prices"("stock_id", "last_trade_date");
CREATE UNIQUE INDEX IF NOT EXISTS "dividends_stock_id_announcement_date_key" ON "dividends"("stock_id", "announcement_date");
CREATE UNIQUE INDEX IF NOT EXISTS "financials_stock_id_year_quarter_key" ON "financials"("stock_id", "year", "quarter");
