#!/usr/bin/env bash
# Production Postgres backup for the PSX Scraper stack.
#
# Dumps the prod scraper database to a compressed, timestamped file under
# BACKUP_DIR and prunes dumps older than BACKUP_KEEP_DAYS.
#
# Install as a nightly cron on the production host (adjust the path if the
# checkout lives elsewhere):
#
#   30 2 * * * /home/deploy/hermes_project/PSX_Scraper_Prod/scripts/backup-db.sh >> /home/deploy/backups/backup.log 2>&1
#
# Idempotent and read-only against the database: `pg_dump` only reads, so it is
# safe to run while the scraper is live.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/deploy/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
CONTAINER="${CONTAINER:-psx_scraper_prod-postgres-1}"
PGUSER="${PGUSER:-psx}"
PGDB="${PGDB:-psx}"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/psx_scraper_prod_${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# Run pg_dump inside the postgres container so the dump tool version matches the
# server version (the host may not have a matching pg_dump installed).
docker exec "${CONTAINER}" pg_dump -U "${PGUSER}" -d "${PGDB}" \
  | gzip -c > "${OUT}"

# Prune dumps older than the retention window.
find "${BACKUP_DIR}" -name 'psx_scraper_prod_*.sql.gz' -mtime "+${BACKUP_KEEP_DAYS}" -delete

echo "$(date -Is) backup written: ${OUT} ($(du -h "${OUT}" | cut -f1))"
