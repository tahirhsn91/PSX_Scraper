-- The data-status endpoint answers "which session do we hold the newest candles for?" once a minute
-- per client, and the answer is MAX(last_trade_date). The only existing index on that column is the
-- leading (stock_id, last_trade_date) pair, which cannot serve a global maximum: Postgres falls back
-- to a sequential scan of the whole price table — measured at 1.7 s over 1.1 M rows on the dev
-- database. This index turns that into an index-only scan in single-digit milliseconds.

CREATE INDEX IF NOT EXISTS "stock_prices_last_trade_date_idx"
  ON "stock_prices" ("last_trade_date" DESC);
