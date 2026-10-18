-- First-party product events (#212). No IP, no user agent, no cookie, no identifier of any kind:
-- a row is an event name, an optional route path, whitelisted properties and a timestamp.
CREATE TABLE "product_events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT,
    "props" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_events_name_created_at_idx" ON "product_events"("name", "created_at" DESC);
CREATE INDEX "product_events_created_at_idx" ON "product_events"("created_at" DESC);
