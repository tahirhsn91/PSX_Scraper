-- Market indices (issue #16): KSE-100 etc. as a first-class resource.
--
-- Indices are NOT stocks: no company page, no sector/ratios/dividends, and the
-- upstream is PSX's time-series endpoint (/timeseries/eod/KSE100) rather than a
-- company page. Hence a separate table pair rather than rows in `stocks`.
--
-- Written by hand rather than via `prisma migrate dev` (which needs a shadow
-- database and an interactive session); constraint names follow the convention
-- Prisma itself emits so a later `migrate dev` sees no drift.

CREATE TABLE IF NOT EXISTS "market_indices" (
  "id"             TEXT         NOT NULL,
  "symbol"         TEXT         NOT NULL,
  "name"           TEXT         NOT NULL,
  "live_value"     DECIMAL(18,4),
  "live_at"        TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_indices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "market_indices_symbol_key" ON "market_indices"("symbol");

CREATE TABLE IF NOT EXISTS "index_values" (
  "id"         TEXT          NOT NULL,
  "index_id"   TEXT          NOT NULL,
  "trade_date" TIMESTAMP(3)  NOT NULL,
  "value"      DECIMAL(18,4) NOT NULL,
  "open"       DECIMAL(18,4),
  "volume"     BIGINT,
  "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "index_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "index_values_index_id_trade_date_key" ON "index_values"("index_id", "trade_date");
CREATE INDEX IF NOT EXISTS "index_values_index_id_trade_date_idx" ON "index_values"("index_id", "trade_date" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'index_values_index_id_fkey'
  ) THEN
    ALTER TABLE "index_values"
      ADD CONSTRAINT "index_values_index_id_fkey"
      FOREIGN KEY ("index_id") REFERENCES "market_indices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed the index the consumer app needs, so GET /api/v1/indices/KSE100 is a valid
-- resource from the first boot instead of a 404 until someone adds it by hand. The
-- worker fills the values on startup; idempotent, so re-running is a no-op.
INSERT INTO "market_indices" ("id", "symbol", "name", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'KSE100', 'KSE-100 Index', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("symbol") DO NOTHING;
