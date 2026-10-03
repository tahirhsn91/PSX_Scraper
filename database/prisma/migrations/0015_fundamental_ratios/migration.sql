-- Fundamental ratio fields for the Stock Details Fundamentals section (issue #131).
--
-- Ten new columns on `ratios`, beside the pe/pb/roe/roa/yield/book/beta/eps row the sync already
-- writes. All come from the Sarmaaya JSON API the scraper already uses:
--
--   details payload (`POST /api/stocks/details/{SYMBOL}`):  FF_NET_MGN, FF_SHS_FLOAT,
--   FF_SHS_FLOAT_PERCENT.
--   ratio series (`GET /api/stocks/fundamentals/ratios?isin=...`): Dividend Payout Ratio,
--   Return on Average Invested Capital (%), Debt to Equity (%), Current Ratio (x),
--   Net Sales YoY Growth (%), EPS Basic YoY Growth (%).
--   dividends endpoint: dps = the newest announced `dividendPerShare`.
--
-- Every column is nullable on purpose (like 0011/0012): a symbol whose source publishes no such
-- figure -- ETFs and preference shares publish no ratios at all, banks publish no Current Ratio,
-- Net Sales YoY Growth or EPS Basic YoY Growth -- must read as unknown (the app's dash), never 0
-- and never a figure derived from a neighbouring metric.
--
-- Written by hand (like 0011/0012/0014) rather than via `prisma migrate dev`; the statements match
-- what Prisma would emit, so a later `migrate dev` sees no drift.

ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "net_profit_margin" DECIMAL(12,4);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "free_float_shares" DECIMAL(24,2);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "free_float_percent" DECIMAL(12,4);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "dps" DECIMAL(12,4);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "payout_ratio" DECIMAL(12,4);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "roic" DECIMAL(12,4);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "debt_to_equity" DECIMAL(12,4);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "current_ratio" DECIMAL(12,4);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "revenue_growth" DECIMAL(12,4);
ALTER TABLE "ratios" ADD COLUMN IF NOT EXISTS "eps_growth" DECIMAL(12,4);
