-- Ex-dividend date. Nullable on purpose: the provider behind this table does not publish one, and a
-- guessed ex-date is worse than an empty cell (it would drive adjustments and yields that never happened).
ALTER TABLE "dividends" ADD COLUMN "ex_date" DATE;
