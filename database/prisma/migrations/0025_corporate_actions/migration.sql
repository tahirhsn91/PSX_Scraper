-- Corporate actions that change what an old price means: splits, bonus issues, rights, cash dividends.
-- `type` is text, not an enum: the exchange publishes more action kinds than this model names, and an
-- unrecognised one must still be stored (dropping it would leave history silently unadjusted).
CREATE TABLE "corporate_actions" (
  "id"          TEXT NOT NULL,
  "stock_id"    TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "ex_date"     DATE,
  "record_date" DATE,
  "ratio_from"  DECIMAL(18,6),
  "ratio_to"    DECIMAL(18,6),
  "amount"      DECIMAL(24,4),
  "status"      TEXT NOT NULL DEFAULT 'confirmed',
  "source_url"  TEXT,
  "fetched_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "corporate_actions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "corporate_actions_stock_id_type_ex_date_key"
  ON "corporate_actions"("stock_id", "type", "ex_date");
CREATE INDEX "corporate_actions_stock_id_ex_date_idx"
  ON "corporate_actions"("stock_id", "ex_date");
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_stock_id_fkey"
  FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
