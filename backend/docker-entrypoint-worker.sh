#!/bin/sh
# Portable entrypoint for the worker container: apply pending migrations, then start the worker.
# Runs the same migrate step as the API entrypoint so the worker is safe to deploy
# independently (e.g. on a platform without Compose-style `depends_on` ordering).
set -e
echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy --schema=../database/prisma/schema.prisma
echo "[entrypoint] starting worker..."
exec node dist/workers/index.js
