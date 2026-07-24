# Database

PostgreSQL schema managed with **Prisma Migrate**.

```
database/
└── prisma/
    ├── schema.prisma          Canonical data model
    ├── seed.ts                Dev seed (a few PSX symbols)
    └── migrations/
        ├── migration_lock.toml
        └── 0001_init/migration.sql
```

## Tables

`stocks`, `stock_prices`, `dividends`, `financials`, `ratios`, `sync_logs`.

`pg_trgm` extension is enabled for fuzzy symbol/company search. Money and ratio
columns use `DECIMAL` to avoid floating-point drift. Composite unique constraints
(`(stock_id, year, quarter)`, `(stock_id, announcement_date)`,
`(stock_id, last_trade_date)`) make scrape persistence idempotent.

## Commands (run from `backend/`, which owns the Prisma client)

```bash
# apply migrations (prod)
npx prisma migrate deploy --schema=../database/prisma/schema.prisma
# generate client
npx prisma generate --schema=../database/prisma/schema.prisma
# seed dev data
npx prisma db seed --schema=../database/prisma/schema.prisma
# create a new migration during development
npx prisma migrate dev --schema=../database/prisma/schema.prisma --name <change>
```

In Docker, `prisma migrate deploy` runs automatically when the backend container starts.
