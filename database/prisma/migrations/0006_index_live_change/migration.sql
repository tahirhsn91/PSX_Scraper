-- The exchange's market-summary page reports every index's point and percent change against
-- its official previous close. Storing those means the index board can show the day's move from
-- the very first scrape, instead of showing nothing until a second session exists in
-- index_values to derive a change from.
--
-- These are the exchange's own figures, carried through unchanged — not numbers derived or
-- estimated by us (see services/indexSummary.ts, which prefers them and falls back to its own
-- calculation only when the page did not report one).
ALTER TABLE "market_indices" ADD COLUMN "live_change" DECIMAL(18, 4);
ALTER TABLE "market_indices" ADD COLUMN "live_change_percent" DECIMAL(10, 4);
