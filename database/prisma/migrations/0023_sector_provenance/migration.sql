-- Classification provenance for `stocks.sector`.
--
-- The sector is the exchange's own classification, read from the PSX company page, and until now
-- nothing recorded where it came from or when it was last seen. A classification without
-- provenance is an assertion without a source: a reader cannot tell a field scraped this morning
-- from one that has quietly held its value since the first sync.
--
-- `sector_updated_at` is deliberately left NULL for existing rows rather than backfilled from
-- `stocks.updated_at` — that timestamp moves for prices and names too, so stamping it here would
-- claim the sector was re-read when it may never have been.

ALTER TABLE "stocks" ADD COLUMN "sector_source" TEXT;
ALTER TABLE "stocks" ADD COLUMN "sector_updated_at" TIMESTAMPTZ;

UPDATE "stocks" SET "sector_source" = 'PSX company page'
WHERE "sector" IS NOT NULL AND TRIM("sector") <> '' AND "sector" <> 'undefined';
