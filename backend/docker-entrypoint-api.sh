#!/bin/sh
# Portable entrypoint for the API container: apply pending migrations, then start the server.
# `prisma migrate deploy` takes a Postgres advisory lock, so it's safe to run
# concurrently from multiple instances/services (e.g. api + worker on Render).
set -e
echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy --schema=../database/prisma/schema.prisma
echo "[entrypoint] starting API server..."
exec node dist/index.js
