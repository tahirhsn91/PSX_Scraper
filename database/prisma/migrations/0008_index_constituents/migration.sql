-- Index membership: which tracked symbols make up a published index.
--
-- The dashboard's first page is the KSE-100 group, driven by the exchange's own member list
-- (scstrade.com). A join table rather than a boolean column on `stocks`: the exchange publishes a
-- list per index, so the next index is a row, not a migration.
--
-- Written by `kse100Membership.service`, which replaces the row set on each pass — a company that
-- leaves the index has to leave this table, or it stays on page one forever.

CREATE TABLE IF NOT EXISTS "index_constituents" (
  "id"         TEXT NOT NULL,
  "index_id"   TEXT NOT NULL,
  "stock_id"   TEXT NOT NULL,
  "name"       TEXT,
  "position"   INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "index_constituents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "index_constituents_index_id_stock_id_key"
  ON "index_constituents"("index_id", "stock_id");

CREATE INDEX IF NOT EXISTS "index_constituents_stock_id_idx"
  ON "index_constituents"("stock_id");

-- Foreign keys, guarded: PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'index_constituents_index_id_fkey'
  ) THEN
    ALTER TABLE "index_constituents"
      ADD CONSTRAINT "index_constituents_index_id_fkey"
      FOREIGN KEY ("index_id") REFERENCES "market_indices"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'index_constituents_stock_id_fkey'
  ) THEN
    ALTER TABLE "index_constituents"
      ADD CONSTRAINT "index_constituents_stock_id_fkey"
      FOREIGN KEY ("stock_id") REFERENCES "stocks"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
