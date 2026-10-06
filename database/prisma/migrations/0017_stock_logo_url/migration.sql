-- Stock logo URL for the dashboard's SYMBOL column icon.
--
-- Read from Sarmaaya's `/api/indices/ALLSHR/companies` board — the same endpoint the index
-- contribution pass already walks, which carries a `logo` URL per constituent. Stored on `stocks`
-- (a column, not a join table) so the dashboard's list query serves it in the same row it already
-- reads, with no extra fetch per page view.
--
-- Nullable on purpose (like 0011/0012/0015/0016): a symbol the source publishes no logo for — the
-- ETFs, preference shares and rights the All-Share board does not carry a logo for — must read as
-- unknown (the frontend's letter-avatar fallback), never as a broken <img> to an invented URL.
--
-- Written by hand (like 0011/0012/0014/0015/0016) rather than via `prisma migrate dev`; the
-- statement matches what Prisma would emit, so a later `migrate dev` sees no drift.

ALTER TABLE "stocks" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;
