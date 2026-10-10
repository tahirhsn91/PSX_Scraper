# PSX Stock Data Scraper & Portfolio Backend

Production-oriented full-stack application for collecting, scraping, storing, and managing Pakistan Stock Exchange (PSX) stock data. Built with Clean Architecture and a pluggable scraper framework.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js (LTS) · Express · TypeScript · Prisma · BullMQ · Puppeteer |
| Frontend | React · TypeScript · Vite · MUI · React Query · React Router · Axios |
| Data | PostgreSQL · Redis |
| Infra | Docker · Docker Compose |

## Repository layout

```
.
├── backend/            Node/Express/TypeScript API + worker
├── frontend/           React/Vite SPA
├── database/           Prisma schema + SQL migrations
├── docker-compose.yml          Base topology (prod)
├── docker-compose.dev.yml Dev overlay: bind mounts + hot reload (pass with -f)
├── .env.example        Copy to .env
└── tasks/              Product backlog (epics/stories/tasks)
```

Services: `frontend`, `backend`, `worker`, `postgres`, `redis`.

## Quickstart (Docker)

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

> The dev overlay is **not** auto-loaded (it is `docker-compose.dev.yml`, not
> `docker-compose.override.yml`), so the `-f` flags above are required for hot reload.
> A bare `docker compose up` runs the production-shaped stack instead.

- Frontend: http://localhost:5100
- API: http://localhost:4001/api/v1
- Swagger UI (interactive API docs): http://localhost:4001/api/docs
- OpenAPI JSON: http://localhost:4001/api/docs.json
- Health: http://localhost:4001/health

> The API host port is configurable via `API_HOST_PORT` in `.env` (defaults to 4000; this setup uses 4001 to avoid a local conflict). Inside Docker the API always listens on 4000.

Migrations run automatically on backend startup (`prisma migrate deploy`).

## API documentation (Swagger)

Interactive Swagger UI is served by the backend at **`/api/docs`**, with the raw OpenAPI 3.0 spec at **`/api/docs.json`**. Every route is documented with parameters, request/response schemas, examples, and error responses, grouped by tag (System, Stocks, History, Search, Sync). Use **Try it out** in the UI to call endpoints directly.

## Local development (without Docker)

You need Node 20+, a local PostgreSQL, and a local Redis. Point `DATABASE_URL` / `REDIS_URL` in `backend/.env` at them, then:

```bash
# database (from repo root)
cd backend && npm install
npx prisma migrate deploy --schema=../database/prisma/schema.prisma
npx prisma generate --schema=../database/prisma/schema.prisma

# API
npm run dev

# worker (separate terminal)
npm run dev:worker

# frontend (separate terminal)
cd ../frontend && npm install && npm run dev
```

## Environment variables

See [.env.example](./.env.example). Key backend vars: `DATABASE_URL`, `REDIS_URL`, `PORT`, `SCRAPER_TIMEOUT`, `SCRAPER_CONCURRENCY`, `CRON_EXPRESSION`, `QUOTE_POLL_CRON`, `QUOTE_POLL_MARKET_HOURS_ONLY`, `QUOTE_POLL_DPS_MIN_INTERVAL_MS`, `SARMAYA_QUOTE_MAX_SYMBOLS`, `LOG_LEVEL`. Frontend: `VITE_API_URL`.

### What polling outside market hours costs

`QUOTE_POLL_MARKET_HOURS_ONLY` is **`true` by default**. The poll's cron is once a minute (`QUOTE_POLL_CRON=*/1 * * * *`), and the guard is what keeps those ticks inside the session — Mon–Fri 09:25–15:35 PKT, about **370 ticks a day**. Setting it to `false` lets the poll run around the clock: **1,440 ticks a day**.

Each tick's volume is bounded by configuration, and the polled universe is **every tracked symbol** (508 today), not the handful this option was written against:

- **DPS quotes** (`dps.psx.com.pk`, the primary source) — at most one sweep per `QUOTE_POLL_DPS_MIN_INTERVAL_MS` (default 5 minutes), one request per symbol at `QUOTE_POLL_CONCURRENCY` (default 5) in parallel: up to 288 sweeps × 508 symbols ≈ **146,000 requests a day** if the source answers every one.
- **Board ticker** (`sarmaaya.pk`) — one request per tick whenever anything is still missing, ≈ **1,400 a day**.
- **Per-symbol tail** (the ETFs, preference shares and renamed tickers the ticker omits) — at most `SARMAYA_QUOTE_MAX_SYMBOLS` (default 12) requests per tick, ≈ **17,000 a day**.

That is the arithmetic ceiling, and it is the reason the guard is on. What holds it down in practice is the **circuit breaker**: after 5 consecutive availability failures — a refusal or a timeout, never a 404 or a parse error — the worker refuses to send that source anything for a cooldown that doubles per re-trip, from 5 minutes up to 60, and announces it in its own log stream (`source.cooling_down`, then `quote-poll.skipped` with `reason: "source-cooling"` and a `resumeAt`). A source that is refusing us therefore sees a handful of requests an hour instead of thousands, while the poll falls through to the next source.

The breaker is **per worker process** — it is rebuilt on restart, and the API process cannot see it, which is why a cooldown is reported in the log stream rather than in `/api/v1/sync/status` (see [docs/architecture.md](./docs/architecture.md)).

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/stocks` | List tracked stocks (paginated) |
| GET | `/stocks/:symbol` | Full stock detail |
| POST | `/stocks` | Add a stock (`{ "symbol": "FFC" }`) → enqueues scrape |
| DELETE | `/stocks/:symbol` | Remove a stock |
| POST | `/stocks/:symbol/sync` | On-demand sync (de-duped) |
| GET | `/stocks/:symbol/history` | Price history (optional `range` preset: 1W/1M/1Y/2Y/3Y/5Y/MAX) |
| POST | `/stocks/:symbol/history/sync` | Fetch historical EOD data for a range (async, de-duped) |
| GET | `/stocks/:symbol/history/status` | Live progress of a history fetch job |
| GET | `/indices` | List tracked market indices (paginated) |
| GET | `/indices/:symbol` | Index summary — `value`, `change`, `changePercent`, `previousClose`, `open`, `volume`, `lastTradeDate` (e.g. `/indices/KSE100`) |
| GET | `/indices/:symbol/history` | Daily index closes, same envelope as `/stocks/:symbol/history` (`range` preset supported) |
| POST | `/indices/:symbol/sync` | On-demand index sync (de-duped) |
| GET | `/indices/:symbol/sync/status` | Live progress of an index sync job |
| GET | `/search?q=` | Fuzzy search (cached) |
| POST | `/sync/all` | Trigger full re-sync |
| GET | `/sync/status` | Live queue status |
| GET | `/sync/logs` | Sync log history |

> **Indices** are a separate resource from stocks: no company profile, sector, ratios or
> dividends, and they are stored in their own tables (`market_indices`, `index_values`).
> `KSE100` is seeded by migration `0003_add_market_indices`, so it is queryable from the
> first boot, and the worker syncs it hourly (plus immediately after a deploy when the
> stored reading is stale). Unlike a stock quote, `high`/`low` are `null` — PSX's index
> time series (`/timeseries/eod/KSE100`, `/timeseries/int/KSE100`) carries close, open and
> volume per day only. To track another index (`KSE30`, `ALLSHR`, …) insert it into
> `market_indices`; the sync path is symbol-generic.

## Documentation

Product backlog and technical breakdown live in [`tasks/`](./tasks/). Architecture and sequence diagrams are in [`docs/`](./docs) *(generated as part of EPIC-10)*.
