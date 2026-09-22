-- Symbols a human removed on purpose.
--
-- The listing page can outlive the listing: ENGRO still has a page even though the company no
-- longer trades under that symbol (the exchange's board carries ENGROH, Engro Holdings). A
-- discovery pass reading that page would register a security that does not exist, which is how a
-- deliberately deleted symbol kept coming back. Every registration path now consults this table.
CREATE TABLE "deleted_symbols" (
    "symbol" TEXT NOT NULL,
    "reason" TEXT,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deleted_symbols_pkey" PRIMARY KEY ("symbol")
);
