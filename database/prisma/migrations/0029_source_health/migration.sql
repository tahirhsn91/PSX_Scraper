-- Per-source scrape health (#214). One row per source id in backend/src/data-sources.ts.
CREATE TABLE "source_health" (
    "source" TEXT NOT NULL,
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "last_error" TEXT,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "source_health_pkey" PRIMARY KEY ("source")
);
