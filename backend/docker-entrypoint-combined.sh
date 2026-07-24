#!/bin/sh
# Entrypoint for the combined API+worker container (single free Render Web Service).
# Same migration approach as the split deployment: `prisma migrate deploy` takes a
# Postgres advisory lock, so it's safe even if run concurrently with another instance.
set -e
echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy --schema=../database/prisma/schema.prisma
echo "[entrypoint] starting combined API + worker process..."
exec node dist/combined.js
