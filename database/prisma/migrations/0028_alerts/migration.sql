-- Device-token-owned price/indicator alerts, and the events they fired.
CREATE TABLE "alerts" (
  "id"               TEXT NOT NULL,
  "owner_token"      TEXT NOT NULL,
  "stock_id"         TEXT NOT NULL,
  "kind"             TEXT NOT NULL,
  "threshold"        DECIMAL(18,4),
  "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
  "paused"           BOOLEAN NOT NULL DEFAULT false,
  "last_fired_at"    TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "alerts_owner_token_idx" ON "alerts"("owner_token");
CREATE INDEX "alerts_stock_id_idx" ON "alerts"("stock_id");
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_stock_id_fkey"
  FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "alert_events" (
  "id"              TEXT NOT NULL,
  "alert_id"        TEXT NOT NULL,
  "fired_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "value"           DECIMAL(18,4),
  "message"         TEXT NOT NULL,
  "channel"         TEXT NOT NULL DEFAULT 'in-app',
  "delivery_status" TEXT NOT NULL DEFAULT 'stored',
  "error"           TEXT,
  CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "alert_events_alert_id_fired_at_idx" ON "alert_events"("alert_id", "fired_at");
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_fkey"
  FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
