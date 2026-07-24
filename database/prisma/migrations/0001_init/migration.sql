-- Extensions for fuzzy / trigram search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- Stocks
CREATE TABLE "stocks" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "company_name" TEXT,
    "sector" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stocks_symbol_key" ON "stocks"("symbol");
CREATE INDEX "stocks_company_name_idx" ON "stocks"("company_name");
CREATE INDEX "stocks_symbol_trgm_idx" ON "stocks" USING GIN ("symbol" gin_trgm_ops);
CREATE INDEX "stocks_company_trgm_idx" ON "stocks" USING GIN ("company_name" gin_trgm_ops);

-- Stock prices
CREATE TABLE "stock_prices" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "current_price" DECIMAL(18,4),
    "change" DECIMAL(18,4),
    "change_percent" DECIMAL(10,4),
    "volume" BIGINT,
    "high" DECIMAL(18,4),
    "low" DECIMAL(18,4),
    "open" DECIMAL(18,4),
    "close" DECIMAL(18,4),
    "market_cap" DECIMAL(24,2),
    "last_trade_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_prices_stock_id_last_trade_date_key" ON "stock_prices"("stock_id", "last_trade_date");
CREATE INDEX "stock_prices_stock_id_last_trade_date_idx" ON "stock_prices"("stock_id", "last_trade_date" DESC);

-- Dividends
CREATE TABLE "dividends" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "announcement_date" TIMESTAMP(3),
    "book_closure" TIMESTAMP(3),
    "payment_date" TIMESTAMP(3),
    "dividend" DECIMAL(18,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dividends_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dividends_stock_id_announcement_date_key" ON "dividends"("stock_id", "announcement_date");

-- Financials
CREATE TABLE "financials" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER,
    "eps" DECIMAL(18,4),
    "sales" DECIMAL(24,2),
    "profit_after_tax" DECIMAL(24,2),
    "assets" DECIMAL(24,2),
    "liabilities" DECIMAL(24,2),
    "equity" DECIMAL(24,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "financials_stock_id_year_quarter_key" ON "financials"("stock_id", "year", "quarter");

-- Ratios
CREATE TABLE "ratios" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "pe_ratio" DECIMAL(12,4),
    "pb_ratio" DECIMAL(12,4),
    "roe" DECIMAL(12,4),
    "roa" DECIMAL(12,4),
    "dividend_yield" DECIMAL(12,4),
    "beta" DECIMAL(12,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ratios_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ratios_stock_id_created_at_idx" ON "ratios"("stock_id", "created_at" DESC);

-- Sync logs
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT,
    "symbol" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "error_message" TEXT,
    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_logs_stock_id_started_at_idx" ON "sync_logs"("stock_id", "started_at" DESC);
CREATE INDEX "sync_logs_status_started_at_idx" ON "sync_logs"("status", "started_at" DESC);

-- Foreign keys
ALTER TABLE "stock_prices" ADD CONSTRAINT "stock_prices_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financials" ADD CONSTRAINT "financials_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ratios" ADD CONSTRAINT "ratios_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
