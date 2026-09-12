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
├── render.yaml          Render Blueprint (API + worker + Redis + optional frontend) — see "Cloud deployment"
├── backend/Dockerfile.combined  Free-tier deploy: API + worker merged into one process — see "Cloud deployment" §2c
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

- Frontend: http://localhost:5173
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

See [.env.example](./.env.example). Key backend vars: `DATABASE_URL`, `REDIS_URL`, `PORT`, `SCRAPER_TIMEOUT`, `SCRAPER_CONCURRENCY`, `CRON_EXPRESSION`, `LOG_LEVEL`. Frontend: `VITE_API_URL`.

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
| GET | `/search?q=` | Fuzzy search (cached) |
| POST | `/sync/all` | Trigger full re-sync |
| GET | `/sync/status` | Live queue status |
| GET | `/sync/logs` | Sync log history |

## Cloud deployment

This app has three parts with different hosting needs: a **static frontend**, a **stateless API**, and a **Puppeteer + BullMQ worker with an hourly cron scheduler** that needs a real, always-on process — serverless platforms (Vercel functions) can't host that piece. Postgres is [Neon](https://neon.tech) in every path below.

|  | Frontend on Render | Frontend on Vercel | Manual + fully free |
|--|--|--|--|
| Platforms to manage | 2 (Render + Neon) | 3 (Vercel + Render + Neon) | 2 (Render + Neon) |
| Backend shape | API + worker as two services | API + worker as two services | API + worker merged into **one** process/service |
| Setup | One Blueprint apply covers everything | Blueprint for API/worker/Redis, separate Vercel import for the frontend | Manual dashboard clicks, no Blueprint |
| Cost | ~$14–20/mo (API+worker on `starter`) | ~$14–20/mo (API+worker on `starter`) | **$0/mo**, with reliability trade-offs (see 2c) |
| When to prefer | Simplest paid path — one dashboard, one bill | You already deploy other frontends on Vercel | Budget is the priority over uptime guarantees |

The first two use [`render.yaml`](./render.yaml) as a Blueprint (API, worker, Redis, optionally the frontend). The free path (2c) doesn't use the Blueprint at all — Render's free plan has no "Background Worker" service type to select, so it needs a different backend shape, built by hand in the dashboard. Either way the core backend/worker code is unchanged — only environment variables and, for the free path, the process entrypoint differ from local Docker.

### 1. Neon — PostgreSQL (same for both paths)

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the **pooled** connection string from the Neon dashboard — it looks like:
   `postgresql://<user>:<password>@<host>-pooler.<region>.aws.neon.tech/<db>?sslmode=require`
3. You'll paste this into `DATABASE_URL` on the API and worker services below. Neon's free tier (500 MB storage, 1 compute unit, autosuspend) is enough for this app's data volume.
4. Migrations run automatically on container start (baked into the Docker image's entrypoint), so there's no separate migration step to run by hand.

### 2. Render — everything (recommended: simplest path)

1. Push this repo to GitHub/GitLab.
2. In the Render dashboard: **New → Blueprint**, point it at the repo. Render reads `render.yaml` and proposes four services: `psx-scraper-api` (web), `psx-scraper-worker` (background worker), `psx-redis` (Key Value), and `psx-scraper-frontend` (static site).
3. Before applying, fill in the secrets it prompts for (marked `sync: false` in the Blueprint):
   - `DATABASE_URL` on **both** the API and worker services — your Neon connection string from step 1.
   - `CORS_ORIGIN` on the API service and `VITE_API_URL` on the frontend service — leave placeholders for now; both reference the other service's URL, so there's a one-time chicken-and-egg step after the first deploy (step 4 below).
4. Apply the Blueprint. Render builds `backend/Dockerfile.api` and `backend/Dockerfile.worker` (see note below on why there are two), provisions Redis, and builds the static frontend — all in one pass.
5. **Wire the two URLs together** (only needed once): once services are up, note the API's URL (e.g. `https://psx-scraper-api.onrender.com`) and the frontend's URL (e.g. `https://psx-scraper-frontend.onrender.com`). Then:
   - On `psx-scraper-frontend` → Environment: set `VITE_API_URL` = `https://psx-scraper-api.onrender.com/api/v1`, then **trigger a manual redeploy** (Vite bakes this in at build time, so just saving the env var isn't enough — the static site has to rebuild).
   - On `psx-scraper-api` → Environment: set `CORS_ORIGIN` = `https://psx-scraper-frontend.onrender.com` (comma-separate if you add a custom domain later), then redeploy.
6. Verify: `https://psx-scraper-api.onrender.com/health` → `{"status":"ok",...}`; `/api/docs` serves Swagger UI; the frontend URL loads the dashboard and **Add Stock** actually triggers a scrape.

Don't want the frontend on Render? Delete the `psx-scraper-frontend` block from `render.yaml` and use the Vercel path instead — see below.

> **Why two Dockerfiles instead of one with `--target`:** Render's Blueprint spec can't select a build stage in a multi-stage Dockerfile (confirmed against current docs). `backend/Dockerfile.api` and `backend/Dockerfile.worker` are self-contained so this works without needing target support, on Render or anywhere else. `docker-compose.yml` references them directly too.
>
> **Why no `command:` override anywhere:** migrations (`prisma migrate deploy`) are baked into each image's entrypoint script (`docker-entrypoint-api.sh` / `docker-entrypoint-worker.sh`), run on every container start. This is idempotent (Prisma takes an advisory lock) and safe even if the API and worker migrate at the same moment — nothing platform-specific needs configuring.
>
> **Cost reality:** the API and worker are set to Render's `starter` plan (free web services spin down after 15 min idle, which breaks a scraper's reliability; the worker also needs real memory for Chromium). Expect roughly $14–20/mo combined for both. Redis and the static frontend both stay free. Adjust `plan:` in `render.yaml` to fit your budget.

### 2b. Vercel — frontend only (alternative to the static-site block above)

1. Import the repo into Vercel: **New Project → import this repo**.
2. Set **Root Directory** to `frontend` (Project Settings → General) — this is a monorepo. [`frontend/vercel.json`](./frontend/vercel.json) handles the build command, output directory, and SPA routing fallback.
3. Add the environment variable `VITE_API_URL` = `https://psx-scraper-api.onrender.com/api/v1` (your Render API URL, with `/api/v1` appended).
4. Deploy — Vercel gives you a URL like `https://psx-scraper.vercel.app`. Set `CORS_ORIGIN` on the Render API service to that URL and redeploy the API, same as step 5 above.

### 2c. Manual, fully free (single combined service, no Blueprint)

Everything above uses `render.yaml` and Render's `starter` plan for the API/worker (~$14–20/mo) because Render's free plan has a hard restriction, confirmed against Render's own Blueprint spec: **`free` is "not available for private services, background workers, or cron jobs."** There is no free "Background Worker" service type at all — it's not a pricing tier you can pick, the option doesn't exist. So a genuinely free deployment can't use the two-service (API + worker) shape above; it needs a different one, built manually in the dashboard rather than from the Blueprint (as requested).

**Architecture change:** [`backend/src/combined.ts`](./backend/src/combined.ts) runs the Express API *and* the three BullMQ workers *and* the hourly scheduler in one Node process — the same code from `src/index.ts` + `src/workers/index.ts`, merged. That lets the whole backend deploy as a single Render **Web Service**, which does support `plan: free`. [`backend/Dockerfile.combined`](./backend/Dockerfile.combined) builds it (same build stage as `Dockerfile.api`/`Dockerfile.worker`, different entrypoint/CMD). This is additive — `Dockerfile.api`, `Dockerfile.worker`, and `render.yaml` are untouched and still work for the paid split-service path above.

> **What "free" actually gets you** (Render's published free-tier specs): 512 MB RAM / 0.1 CPU per instance, spins down after 15 min with no inbound HTTP traffic, 750 free instance-hours per **workspace** per month, 100 GB outbound bandwidth, 500 build-pipeline minutes. ([Render free-tier docs](https://render.com/docs/free), [instance specs](https://render.com/docs/compute-plans)) One service running continuously is ~720–744 instance-hours/month — it fits under the 750 cap, but with almost no headroom left for any other free compute service in the same workspace. Squeezing Express + a Puppeteer/Chromium browser into 512 MB is tight, so keep concurrency at 1 (see step 3 below) — this app's scrape volume is small enough that sequential processing is fine, just slower than the paid path's `concurrency: 2`.

1. **Neon** — same as step 1 above (free tier: 500 MB storage, autosuspend).

2. **Redis — New → Key Value** (Render dashboard, not Blueprint):
   - Name: `psx-redis`, Plan: **Free** (25 MB), Region: same as the web service below.
   - `ipAllowList`: leave empty/internal-only. Maxmemory policy: **noeviction** (BullMQ loses jobs silently under any eviction policy — this is a hard requirement, not a tuning knob).
   - After it's created, copy its **internal connection string** from the Key Value's "Connect" tab.

3. **Backend — New → Web Service** (not Blueprint):
   - Connect the repo, Runtime: **Docker**, Dockerfile Path: `backend/Dockerfile.combined`, Docker Build Context Directory: `.` (repo root — the Dockerfile's `COPY` paths assume this).
   - Plan: **Free**. Region: same as Redis (same-region traffic is what keeps latency and egress low).
   - Health Check Path: `/health`.
   - Environment variables (Environment tab, add one by one):
     | Key | Value |
     |-----|-------|
     | `DATABASE_URL` | Neon pooled connection string from step 1 |
     | `REDIS_URL` | the Key Value internal connection string from step 2 |
     | `PORT` | `4000` |
     | `NODE_ENV` | `production` |
     | `LOG_LEVEL` | `info` |
     | `CORS_ORIGIN` | placeholder for now — set for real in step 5 |
     | `SCRAPER_TIMEOUT` | `30000` |
     | `SCRAPER_CONCURRENCY` | `1` (not `2` — see the RAM note above) |
     | `SCRAPER_DELAY_MS` | `500` |
     | `CRON_EXPRESSION` | `0 * * * *` |
     | `SEARCH_CACHE_TTL` | `45` |
     | `WORKER_CONCURRENCY` | `1` (not `2`) |
     | `TRUST_PROXY` | `1` (Render's edge is one hop — needed so `express-rate-limit` reads the real client IP instead of throwing `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`) |
     | `BROWSER_LAUNCH_TIMEOUT` | `20000` (ms — caps how long a Chromium launch can hang before failing the job instead of blocking the browser pool forever; see troubleshooting note below) |
   - Create the service. Render builds `Dockerfile.combined`; on boot the entrypoint runs `prisma migrate deploy` then starts `dist/combined.js`.

4. **Frontend — New → Static Site** (not Blueprint):
   - Connect the repo, Root Directory: `frontend`, Build Command: `npm install && npm run build`, Publish Directory: `dist`.
   - Plan is free by default for static sites (no toggle needed).
   - Environment variable: `VITE_API_URL` — set once you know the backend's URL in step 5.
   - Add a rewrite rule (Redirects/Rewrites tab, since there's no `render.yaml` to declare it): Source `/*` → Destination `/index.html`, Action **Rewrite** — this is the SPA fallback for direct links like `/stocks/FFC`.

5. **Wire the URLs together** (same chicken-and-egg step as the Blueprint path): once both services have a Render URL, set `VITE_API_URL` on the static site to `https://<backend>.onrender.com/api/v1` and manually redeploy it (Vite bakes this in at build time), then set `CORS_ORIGIN` on the backend to `https://<frontend>.onrender.com` and let it redeploy.

6. **Keep it awake** (the part the Blueprint path avoids by paying for `starter`): a free Web Service spins down after 15 minutes with no inbound HTTP request, which pauses the in-process BullMQ workers and hourly scheduler along with it. Set up an external pinger hitting `https://<backend>.onrender.com/health` every 10–14 minutes — [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com) both have free tiers that do this. Be aware this is a known workaround, not an officially supported pattern: it's not guaranteed to survive changes to Render's idle-detection, and it pushes the service close to using its full monthly instance-hour allowance (step-0 math above) with no slack for other free services in the same workspace. If you're fine with the scraper going quiet overnight and waking up on the next request (30–60s cold start), skip the pinger entirely — simpler, still free, just less "always on."

> **Why not just add a `plan: free` line to the existing `render.yaml`?** The Blueprint's `worker` service block has no free option to switch to — the restriction is on the *service type*, not the plan name. That's why this path uses a different Dockerfile/entrypoint (`combined.ts`) and manual dashboard creation instead of editing the Blueprint.

> **Troubleshooting — "Add Stock" / "Sync" never finishes:** check `/api/v1/sync/status`. If a `stock-sync` job sits `active` indefinitely with nothing in the logs (no `browser.launched`, no `sync.complete`/`sync.failed`), Chromium's launch is hanging — the free instance's 512MB RAM / 0.1 CPU can be too little for it to start cleanly. `BROWSER_LAUNCH_TIMEOUT` (default 20s) turns that hang into a clean failure instead of an indefinite block, but if launches keep timing out, the free instance genuinely may not have enough headroom to run Puppeteer reliably — consider `SCRAPER_CONCURRENCY=1` (already the default here), or moving the worker to a paid instance while keeping everything else free.

### 3. Verify end-to-end

- Open the frontend URL, add a stock (e.g. `FFC`) — this calls the Render API, which enqueues a job on Render's Redis, picked up by the Render worker.
- Watch the sync progress on the dashboard; check `GET https://psx-scraper-api.onrender.com/api/v1/sync/status` if you want to see it server-side.
- The hourly cron scheduler registers itself when the worker boots (`registerScheduler()` in `backend/src/jobs/scheduler.ts`) — no extra setup needed, it runs on Render's clock via the same BullMQ repeatable job used locally.

### Alternative: rearchitect for all-serverless (Vercel functions, no Render)

If cost or platform-count matters more than preserving the worker exactly as built, scraping could move into Vercel Cron–triggered functions (`@sparticuz/chromium` + `puppeteer-core`, Upstash Redis over TCP for BullMQ compatibility). That path needs real code changes — a different job-queue model and progress-reporting UX, since there's no long-lived worker process to poll — and Vercel's Hobby-tier cron is capped at once/day (hourly needs Pro, $20/mo/seat). Happy to scope that rewrite separately if you'd rather go that route later.

## Documentation

Product backlog and technical breakdown live in [`tasks/`](./tasks/). Architecture and sequence diagrams are in [`docs/`](./docs) *(generated as part of EPIC-10)*.
