-- Official company/exchange notices. `stock_id` is nullable: market-wide notices exist and forcing
-- a stock would either drop them or attach them to an arbitrary symbol.
CREATE TABLE "announcements" (
  "id"           TEXT NOT NULL,
  "stock_id"     TEXT,
  "category"     TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "summary"      TEXT,
  "body"         TEXT,
  "published_at" TIMESTAMP(3) NOT NULL,
  "source"       TEXT NOT NULL,
  "source_url"   TEXT NOT NULL,
  "dedupe_key"   TEXT NOT NULL,
  "fetched_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
-- Idempotency: re-running the ingestor stores nothing twice.
CREATE UNIQUE INDEX "announcements_source_dedupe_key_key" ON "announcements"("source", "dedupe_key");
CREATE INDEX "announcements_published_at_idx" ON "announcements"("published_at");
CREATE INDEX "announcements_stock_id_published_at_idx" ON "announcements"("stock_id", "published_at");
CREATE INDEX "announcements_category_idx" ON "announcements"("category");
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_stock_id_fkey"
  FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
