-- Remove price rows stamped on a weekend.
--
-- The PSX company page carries no trade date, so every sync stamped its reading with "today", and
-- on a Saturday or Sunday that produced a row for a session the exchange never held — 2,101 rows
-- across five weekends on the dev database, each carrying the previous session's price and volume.
--
-- They are not merely untidy. Each one became the "newest row" for its symbol, and the next sync's
-- change% check compared the source's figure against that copy of the previous close: implied
-- 0.00%, the real move rejected, change_percent written as NULL. PRL's +3.07% disappeared this way.
-- Migration 0021's status endpoint and the movers ranking both read the newest row, so the whole
-- board inherited the error.
--
-- The write path now clamps the stamp to a trading day (see verifyAndPersist), so no new weekend
-- rows can appear. This only removes the ones already stored.
--
-- Verified before deleting: no tracked symbol has weekend rows *without* weekday rows, so nothing
-- loses its only price. The PSX does not hold weekend sessions, so the predicate cannot be wrong
-- about a legitimate row.

DELETE FROM "stock_prices"
WHERE EXTRACT(DOW FROM "last_trade_date") IN (0, 6);
