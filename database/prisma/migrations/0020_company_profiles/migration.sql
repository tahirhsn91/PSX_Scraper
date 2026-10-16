-- Company profile: the "Company Description" section on a stock page.
--
-- Everything in these two tables is *editorial*, not scraped. That is the whole point of the
-- feature and the reason this migration exists at all: no source this project integrates
-- publishes a company description, CEO, website, phone number or product list. Sarmaaya's
-- company record (`/api/stocks/{SYMBOL}`, where our `sector` comes from) carries identity and a
-- quote only, its stock page fetches no profile-shaped endpoint, and the exchange's own company
-- pages are unreachable from this host. Probed 2026-10-16 while scoping issue #180 — see
-- `psx-scraper-extraction` → references/sarmaaya-rest-api.md, which now records the gap so it is
-- not re-probed as a maybe.
--
-- Consequences that shaped the shape below:
--
--   * Two tables rather than columns on `stocks`. This is nullable content on a hot table, and
--     products are one-to-many, so a column would be either a delimited string or a second
--     migration later.
--   * Every content column is NULLABLE and there is no backfill. Content arrives company by
--     company; the overwhelmingly common state for the next while is "no row". A stock with no
--     profile renders no section at all, so absence must be cheap and must never look like an
--     empty box.
--   * Coverage is expected to be sparse for a long time. 511 symbols are tracked, and writing a
--     description plus products plus correctly licensed images for each is editorial work, not a
--     scrape — so the schema is built for the whole board on day one while the content grows in
--     batches, and nothing needs re-architecting as it fills.
--
-- Written by hand (like 0011/0012/0014/0015/0016/0017) rather than via `prisma migrate dev`; the
-- statements match what Prisma would emit, so a later `migrate dev` sees no drift.

CREATE TABLE IF NOT EXISTS "company_profiles" (
    "id"          TEXT NOT NULL,
    "stock_id"    TEXT NOT NULL,
    "description" TEXT,
    "head_office" TEXT,
    "phone"       TEXT,
    "website"     TEXT,
    "ceo"         TEXT,
    "source_note" TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- One profile per company. Enforced in the database rather than by convention, because the
-- upsert script addresses a profile by its symbol and a duplicate row would silently win by
-- read order.
CREATE UNIQUE INDEX IF NOT EXISTS "company_profiles_stock_id_key"
    ON "company_profiles"("stock_id");

ALTER TABLE "company_profiles" DROP CONSTRAINT IF EXISTS "company_profiles_stock_id_fkey";
ALTER TABLE "company_profiles"
    ADD CONSTRAINT "company_profiles_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "company_products" (
    "id"            TEXT NOT NULL,
    "profile_id"    TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "summary"       TEXT,
    "image_path"    TEXT,
    "image_source"  TEXT,
    "image_licence" TEXT,
    "position"      INT NOT NULL,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_products_pkey" PRIMARY KEY ("id")
);

-- The section reads a profile's products in the order the writer chose, so the index is
-- (profile_id, position) rather than profile_id alone.
CREATE INDEX IF NOT EXISTS "company_products_profile_id_position_idx"
    ON "company_products"("profile_id", "position");

ALTER TABLE "company_products" DROP CONSTRAINT IF EXISTS "company_products_profile_id_fkey";
ALTER TABLE "company_products"
    ADD CONSTRAINT "company_products_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "company_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
