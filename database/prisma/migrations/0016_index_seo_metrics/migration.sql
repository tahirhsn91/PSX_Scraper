-- Index SEO metrics: 52-week high/low and market capitalisation, for the index page's on-page
-- SEO meta description (PR #134).
--
-- Read from Sarmaaya's `/api/indices` board — the only reachable source that publishes them
-- (see the note in indexSummary.ts: the exchange's carousel and Sarmaaya's market-view carry
-- neither; `/api/indices` carries high52/low52/marketCap). Stored on `market_indices` so the
-- summary endpoint serves them without an extra fetch on every page view.
--
-- Nullable on purpose (like 0011/0012/0015): an index whose board row publishes no figure must
-- read as unknown (the app's dash), never 0 and never a derived number.
--
-- Written by hand (like 0011/0012/0014/0015) rather than via `prisma migrate dev`; the statements
-- match what Prisma would emit, so a later `migrate dev` sees no drift.

ALTER TABLE "market_indices" ADD COLUMN IF NOT EXISTS "week52_high" DECIMAL(18,4);
ALTER TABLE "market_indices" ADD COLUMN IF NOT EXISTS "week52_low" DECIMAL(18,4);
ALTER TABLE "market_indices" ADD COLUMN IF NOT EXISTS "market_cap" DECIMAL(24,2);
