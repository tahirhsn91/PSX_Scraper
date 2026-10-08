-- Income statement per stock, as line-item rows keyed by (stock, period, metric).
--
-- The Sarmaaya JSON API's `GET /api/stocks/fundamentals/income-statement?isin=…` publishes the full
-- income statement (Revenue → Diluted EPS for an industrial; Interest Income → Diluted EPS for a
-- bank). Because the *set* of rows differs by sector, it is stored as ordered rows rather than a
-- fixed set of columns: `position` keeps the statement's own line order and the UI renders whatever
-- rows the source published for that security.
--
-- One column per period: `period_key` is "TTM" for the trailing-twelve-month reading (the LTM
-- series' newest point) or a fiscal year ("2025") for the annual series. `periodicity` records which
-- series the row came from.
--
-- `value` is nullable on purpose: a source that publishes no figure for a period (banks publish no
-- Revenue; the annual series repeats a stale placeholder down older rows, which the scraper drops)
-- must read as unknown (the app's dash), never 0.
--
-- Written by hand (like 0014) rather than via `prisma migrate dev`; the statements match what Prisma
-- would emit, so a later `migrate dev` sees no drift.
CREATE TABLE IF NOT EXISTS "income_statements" (
    "id"          TEXT NOT NULL,
    "stock_id"    TEXT NOT NULL,
    "period_key"  TEXT NOT NULL,
    "periodicity" TEXT NOT NULL,
    "metric_code" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "value"       DECIMAL(24,4),
    "position"    INTEGER NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "income_statements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "income_statements_stock_id_period_key_metric_code_key"
  ON "income_statements" ("stock_id", "period_key", "metric_code");

CREATE INDEX IF NOT EXISTS "income_statements_stock_id_period_key_idx"
  ON "income_statements" ("stock_id", "period_key");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'income_statements_stock_id_fkey'
  ) THEN
    ALTER TABLE "income_statements"
      ADD CONSTRAINT "income_statements_stock_id_fkey"
      FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
