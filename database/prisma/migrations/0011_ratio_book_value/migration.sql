-- Book value per share (issue #79).
--
-- Sarmaaya's public API publishes it per symbol (`Book Value Per Share` / `FF_BPS`, equity divided
-- by shares outstanding), and the app's Valuation card has a Book Value row that has had no column
-- behind it anywhere in the schema. One new column on `ratios`: that row already carries
-- pe_ratio / pb_ratio / roe / roa / dividend_yield / beta for the same sync, and the read path
-- already serves the newest such row, so book value belongs beside them rather than in a table of
-- its own.
--
-- Nullable on purpose: a symbol whose source publishes no book value must read as unknown (the
-- dashboard renders a dash) rather than as a zero. Existing rows keep NULL until their next sync
-- fills them -- nothing is backfilled from a guess, and a stored value is never borrowed from
-- another symbol.
--
-- Written by hand (like 0003/0004/0010) rather than via `prisma migrate dev`, which needs a shadow
-- database and an interactive session; the statements match what Prisma would emit, so a later
-- `migrate dev` sees no drift.

ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "book_value" DECIMAL(12,4);
