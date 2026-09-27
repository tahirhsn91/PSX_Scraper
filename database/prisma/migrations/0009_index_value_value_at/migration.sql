-- When the reading behind a row's `value` was taken, so a stored value's provenance is knowable.
--
-- An index's daily row is upserted in place on every pass of the board snapshot, so its `value` is
-- "whatever the last successful pass of that day read". When the later passes of a session do not
-- land, an early reading stands as the day's number — measured on 2026-09-26: all 17 indices' newest
-- rows were written at 09:25 PKT, five minutes before the session opened, and the exchange's level
-- for that session differed from every one of them. The DPS series that used to correct this with a
-- real close is refused at the edge, so nothing overwrote it.
--
-- `created_at` cannot answer this: it is the row's *first* write, and for a session's row that is
-- usually the pre-open pass. `value_at` is the instant of the reading that produced the value the
-- row currently holds.
--
-- Nullable and additive, and null is meaningful: "no reading we can point at", which is exactly the
-- state every existing row is in.

ALTER TABLE "index_values" ADD COLUMN IF NOT EXISTS "value_at" TIMESTAMP(3);
