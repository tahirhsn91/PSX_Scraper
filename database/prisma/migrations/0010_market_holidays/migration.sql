-- The exchange's published market holidays.
--
-- Why: the trading calendar this pipeline assumed was "Monday-Friday, 09:30-15:30 PKT", and a
-- weekday holiday is indistinguishable from a trading weekday under that rule. 2026-08-26 - a
-- Wednesday the exchange never opened - is stored as 441 `stock_prices` rows with `volume = 0` and
-- the previous session's close carried forward, and the index board stamped its session row before
-- the open. PSX publishes the list itself, on the reachable `www.psx.com.pk` host.
--
-- The dates are PKT calendar days, stored as DATE. A missing row means "not a listed holiday", so
-- callers must also be able to tell "not listed" from "could not be read" - that distinction lives
-- in `marketCalendar.service.ts`, not here.
CREATE TABLE "market_holidays" (
    "id"         TEXT NOT NULL,
    "date"       DATE NOT NULL,
    "name"       TEXT NOT NULL,
    "days"       INTEGER,
    "partial"    BOOLEAN NOT NULL DEFAULT false,
    "source"     TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_holidays_pkey" PRIMARY KEY ("id")
);

-- One row per calendar day: the refresh is an upsert, and a duplicate would let a holiday appear
-- twice in a gate that only ever asks "is this day on the list".
CREATE UNIQUE INDEX "market_holidays_date_key" ON "market_holidays"("date");

-- The gate's read path is always "this day", so the unique index above is the one that matters;
-- this covers the range read that loads a whole year at once.
CREATE INDEX "market_holidays_date_idx" ON "market_holidays"("date");
