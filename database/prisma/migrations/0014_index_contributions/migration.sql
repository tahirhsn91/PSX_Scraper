-- Per-constituent index contribution: how many index points each stock moved its index by, plus its
-- share of the index, as published by the exchange's contribution table.
--
-- The dashboard's stocks table shows this as a `POINTS` column, and the requirement is that it is
-- *real time*, so it cannot come from the daily close series. Two decisions follow from that and are
-- worth recording here rather than in a commit message:
--
-- 1. **One row per (index, stock), overwritten — not history.** The capture runs every couple of
--    minutes through the session (see the `index-contributions` repeatable job) and there are ~550
--    rows in play; appending would add ~550 rows a tick, ~200k a session, to answer a question
--    ("what is this stock contributing now") that only ever reads the newest row. A history can be
--    added later as its own table if it is ever wanted; it cannot be recovered from this one.
--
-- 2. **`points` is nullable and a missing reading is NULL, never 0.** The source carries
--    constituents it has published no figures for — `points`, `weights`, `curr`, `marketCap` all
--    zero (63 such rows in the ALLSHR payload the day this was written). A zero there would render as
--    "this stock contributed nothing", which is a different and false claim; NULL renders as a dash.
--    A genuine zero contribution is stored as 0, and is distinguishable because `level` (the
--    constituent's own price in the same reading) is not zero.
--
-- `level` exists for reconciliation: it is the price the contribution was measured at, so a stored
-- figure can be checked against the price of the same reading rather than trusted on its own.
CREATE TABLE IF NOT EXISTS "index_contributions" (
    "id"          TEXT NOT NULL,
    "index_id"    TEXT NOT NULL,
    "stock_id"    TEXT NOT NULL,
    "points"      DECIMAL(20,4),
    "weight"      DECIMAL(12,4),
    "level"       DECIMAL(20,4),
    "captured_at" TIMESTAMP(3) NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "index_contributions_pkey" PRIMARY KEY ("id")
);

-- The list query looks a symbol's contribution up by stock (a LATERAL join per row, see
-- stock.repository's list), so the stock side is the side that needs an index of its own; the unique
-- key covers the (index, stock) upsert the capture uses.
CREATE UNIQUE INDEX IF NOT EXISTS "index_contributions_index_id_stock_id_key"
  ON "index_contributions" ("index_id", "stock_id");

CREATE INDEX IF NOT EXISTS "index_contributions_stock_id_idx"
  ON "index_contributions" ("stock_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'index_contributions_index_id_fkey'
  ) THEN
    ALTER TABLE "index_contributions"
      ADD CONSTRAINT "index_contributions_index_id_fkey"
      FOREIGN KEY ("index_id") REFERENCES "market_indices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'index_contributions_stock_id_fkey'
  ) THEN
    ALTER TABLE "index_contributions"
      ADD CONSTRAINT "index_contributions_stock_id_fkey"
      FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
