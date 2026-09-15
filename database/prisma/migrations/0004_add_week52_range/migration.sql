-- 52-week low/high (issue #25): stored on the price row, as PSX publishes it on the
-- company page ("52-WEEK RANGE" -> data-low/data-high on the .numRange node).
--
-- Nullable on purpose: Sarmaaya does not publish a 52-week range at all, and a stock whose
-- page has no such block must read as "unknown" rather than as a zero. Existing rows keep
-- NULL until their next company-page sync fills them.
--
-- Written by hand (like 0003) rather than via `prisma migrate dev`, which needs a shadow
-- database and an interactive session; the statements match what Prisma would emit, so a
-- later `migrate dev` sees no drift.

ALTER TABLE "stock_prices" ADD COLUMN IF NOT EXISTS "week52_high" DECIMAL(18,4);
ALTER TABLE "stock_prices" ADD COLUMN IF NOT EXISTS "week52_low"  DECIMAL(18,4);
