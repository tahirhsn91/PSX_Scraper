-- Earnings per share (the Valuation card's last empty row).
--
-- Sarmaaya's snapshot publishes it as `FF_EPS` on the same metric table this module already reads
-- for P/E, P/B and dividend yield, and the scraper has been *parsing* it since #79 -- `METRIC.eps`,
-- `SarmaayaDetails.eps` -- with no column to put it in, so every sync fetched the figure, dropped it
-- and the card rendered a dash. One new column on `ratios`, beside the pe/pb/roe/roa/yield/book/beta
-- row written by the same sync: the read path already serves the newest such row.
--
-- Nullable on purpose, like 0011's book_value: a symbol whose source publishes no EPS must read as
-- unknown (the app's dash) rather than as a zero. Nothing is backfilled from a guess and a stored
-- value is never borrowed from another symbol.
--
-- Written by hand (like 0003/0004/0010/0011) rather than via `prisma migrate dev`, which needs a
-- shadow database and an interactive session; the statements match what Prisma would emit, so a
-- later `migrate dev` sees no drift.

ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "eps" DECIMAL(12,4);
