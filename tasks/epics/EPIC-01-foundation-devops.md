# EPIC-01 — Foundation & DevOps

**Priority:** P0 · **Total points:** 29 · **Depends on:** none

## Goal
Establish the monorepo, TypeScript build tooling, code-quality gates, containerization, and environment/config contracts so that every downstream epic builds on a consistent, reproducible base. "Done" means a developer can clone, run `docker compose up`, and get backend + frontend + PostgreSQL + Redis running locally with hot reload.

---

## STORY-01.1 — Monorepo & workspace scaffolding
**As a** developer **I want** a clean monorepo layout **so that** backend and frontend evolve independently but share tooling.
**Points:** 3 · **Priority:** P0 · **Depends on:** none

**Acceptance Criteria**
- Root repo contains `backend/` and `frontend/` packages with independent `package.json` and `tsconfig.json`.
- Backend `src/` matches the prescribed structure (`controllers, services, repositories, scrapers, jobs, workers, routes, middleware, config, database, prisma, validators, utils, types`).
- A single command installs all workspace dependencies.
- `.gitignore`, `.editorconfig`, and `.nvmrc` (pinned to latest Node LTS) are present.

**Tasks**
- [ ] Initialize git repo and root `package.json` (npm/pnpm workspaces).
- [ ] Scaffold `backend/` with the full `src/` folder tree and placeholder `index.ts`.
- [ ] Scaffold `frontend/` via Vite React-TS template.
- [ ] Add `.gitignore`, `.editorconfig`, `.nvmrc`, root `README` stub.

**Technical Notes:** Use pnpm or npm workspaces; keep a single lockfile at root. Node LTS pinned via `.nvmrc` and `engines`.

---

## STORY-01.2 — TypeScript configuration & path aliases
**Points:** 3 · **Priority:** P0 · **Depends on:** STORY-01.1

**Acceptance Criteria**
- Strict mode enabled (`strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`).
- Path aliases (e.g. `@services/*`, `@repositories/*`) resolve in build, test, and runtime (ts-node / tsx / tsc-alias).
- `tsc --noEmit` passes on an empty scaffold.

**Tasks**
- [ ] Author backend `tsconfig.json` (strict) + `tsconfig.build.json`.
- [ ] Configure path aliases and ensure runtime resolution (tsconfig-paths / tsc-alias).
- [ ] Wire `dev` (tsx watch) and `build` (tsc) scripts.

**Technical Notes:** Prefer `tsx` for dev hot-reload; emit to `dist/` for production image.

---

## STORY-01.3 — Linting, formatting & commit hygiene
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-01.2

**Acceptance Criteria**
- ESLint (typescript-eslint) + Prettier configured with no conflicts; `lint` and `format:check` scripts pass.
- Husky pre-commit runs lint-staged (ESLint + Prettier on staged files).
- commitlint enforces Conventional Commits on `commit-msg`.
- Shared config applies to both backend and frontend.

**Tasks**
- [ ] Add ESLint flat config + Prettier + `eslint-config-prettier`.
- [ ] Configure Husky, lint-staged, commitlint + conventional config.
- [ ] Add `lint`, `lint:fix`, `format`, `format:check` scripts to both packages.
- [ ] Document the commit convention in README.

**Technical Notes:** Use ESLint flat config (v9). Keep frontend/backend rule overrides in per-package configs extending a root base.

---

## STORY-01.4 — Dockerfiles for backend, worker & frontend
**Points:** 8 · **Priority:** P0 · **Depends on:** STORY-01.2

**Acceptance Criteria**
- Multi-stage backend Dockerfile produces a slim production image; a worker target reuses the build but starts the worker entrypoint.
- Worker image includes Chromium/Puppeteer OS dependencies and runs headless successfully.
- Frontend Dockerfile builds static assets and serves via nginx (or Vite preview) for prod; dev uses Vite dev server.
- Images build cleanly in CI with layer caching.

**Tasks**
- [ ] Backend multi-stage Dockerfile (deps → build → runtime) with non-root user.
- [ ] Worker Dockerfile/target with Puppeteer system deps (`libnss3`, fonts, etc.) or `puppeteer` base image.
- [ ] Frontend Dockerfile (build → nginx static serve) + nginx config with SPA fallback.
- [ ] Add `.dockerignore` files.

**Technical Notes:** Consider `ghcr.io/puppeteer/puppeteer` or install Chromium deps explicitly. Run as non-root; set `--no-sandbox` flags only inside the container context.

---

## STORY-01.5 — Docker Compose orchestration
**Points:** 5 · **Priority:** P0 · **Depends on:** STORY-01.4

**Acceptance Criteria**
- `docker compose up` starts `frontend`, `backend`, `worker`, `postgres`, `redis`.
- Healthchecks defined for postgres and redis; backend/worker wait on them (`depends_on: condition: service_healthy`).
- Named volumes persist Postgres data and Redis (if AOF enabled); source bind-mounts enable dev hot reload.
- Service-to-service networking uses compose DNS names (no hardcoded IPs).

**Tasks**
- [ ] Author `docker-compose.yml` (base) + `docker-compose.override.yml` (dev bind mounts).
- [ ] Add postgres + redis with healthchecks and named volumes.
- [ ] Wire env files and inter-service URLs.
- [ ] Verify cold-start ordering and hot reload.

**Technical Notes:** Split base vs dev override so prod compose stays clean. Redis and Postgres reachable at `redis:6379` / `postgres:5432`.

---

## STORY-01.6 — Configuration & environment validation
**Points:** 3 · **Priority:** P0 · **Depends on:** STORY-01.2

**Acceptance Criteria**
- Backend loads and validates env at boot (`DATABASE_URL`, `REDIS_URL`, `PORT`, `SCRAPER_TIMEOUT`, `CRON_EXPRESSION`, `LOG_LEVEL`); process exits with a clear message if invalid.
- Frontend consumes `VITE_API_URL`.
- `.env.example` files exist for both packages and are documented.
- A typed `config` module is the single source for env access (no scattered `process.env`).

**Tasks**
- [ ] Implement `config/env.ts` with Zod schema + parse-on-boot.
- [ ] Add `.env.example` (backend + frontend).
- [ ] Replace all direct `process.env` reads with the typed config export.

**Technical Notes:** Fail fast on missing/invalid env. Provide sane defaults only for non-secrets (e.g. `PORT=4000`, `LOG_LEVEL=info`).

---

## STORY-01.7 — CI pipeline
**Points:** 2 · **Priority:** P1 · **Depends on:** STORY-01.3

**Acceptance Criteria**
- CI runs on PR: install → lint → typecheck → test → build (both packages).
- Docker images build in CI (at least on main).
- Pipeline fails the PR on any gate failure.

**Tasks**
- [ ] Add CI workflow (GitHub Actions) with a Node matrix.
- [ ] Cache dependencies and Prisma client.
- [ ] Add build-image job for main branch.

**Technical Notes:** Reuse the same scripts locally and in CI to avoid drift.

---

## Epic-level risks & open questions
- **Risk:** Puppeteer in containers is the biggest footprint/dependency risk — validate the worker image early (STORY-01.4) before EPIC-03 depends on it.
- **Open question:** pnpm vs npm workspaces — pick before STORY-01.1 to avoid a lockfile migration.
- **Dependency:** All other epics are blocked until STORY-01.1–01.6 complete.
