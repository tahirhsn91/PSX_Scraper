# AGENTS.md — PSX Stock Scraper

Rules for any AI agent working in this repository (Hermes Agent, Claude Code, Codex,
OpenCode…). Human contributors are expected to follow the same rules.

---

## 1. Protected branches — no direct commits, no direct pushes

`main` and `develop` are **protected branches**.

- **Never commit directly on `main` or `develop`.**
- **Never push directly to `main` or `develop`** (including
  `git push origin HEAD:main`, `--force`, force-with-lease, or deleting the branch).
- All changes reach them through a **pull request** — no exceptions for "small",
  "obvious", "docs-only", or "hotfix" changes.

Enforced in three places, so "I didn't know" is not a failure mode:

| Layer | What it does |
|---|---|
| GitHub repository rulesets (`main`, `develop`) | Server-side, and applies to admins too (no bypass actors). Rejects any direct push with `GH013 … Changes must be made through a pull request`, and separately blocks force-pushes and branch deletion. |
| `.githooks/pre-commit` | Local: refuses to create a commit while on `main`/`develop`. |
| `.githooks/pre-push` | Local: refuses any push whose destination ref is `main`/`develop`. |

Consequence of the server-side half being non-negotiable: once a commit has landed on a
protected branch there is **no way to take it back** from the command line — force-pushing
it away is itself blocked. Getting history back in line needs an admin to temporarily
disable the ruleset in repository settings. So the cheap move is to never push there in
the first place.

### The workflow to use instead

```bash
git fetch origin
git switch -c feat/<short-name> origin/develop   # or origin/main — branch off where the change belongs
# ...edit, commit as usual (hooks allow this on a feature branch)...
git push -u origin HEAD
gh pr create --base develop --fill               # or --base main
```

Then stop: the PR is the deliverable. Do not merge it yourself, and do not
"helpfully" push the branch's commits onto the protected branch afterwards.

### Local hooks setup (once per clone)

The hook scripts are tracked in `.githooks/`, but git does not activate them
automatically on clone:

```bash
git config core.hooksPath .githooks
```

### Emergency override

If a protected branch genuinely must be written to outside a PR (production
incident, broken deploy), it is a deliberate, loudly-announced act:

```bash
ALLOW_PROTECTED=1 git commit -m "..."     # local hook escape hatch
ALLOW_PROTECTED=1 git push origin main    # local hook escape hatch
```

The GitHub-side protection is **not** bypassed by that variable — an admin has to
temporarily disable protection in the repo settings first, and must re-enable it
afterwards. Prefer opening the PR and merging it.

---

## 2. Environment files

- `.env` is the production environment file for this checkout. It is gitignored
  (`.gitignore` covers `.env` and `.env.*`) — **never commit it, never paste its
  values into a commit, PR description, or log**.
- `.env.example` is the only env file that belongs in git. When you add a new
  variable, add it to both `.env.example` and the relevant service block in
  `render.yaml`, with a comment explaining it.
- Variables are validated at boot by `backend/src/config/env.ts` (zod). A missing
  or malformed required var (`DATABASE_URL`, `REDIS_URL`) makes the process exit(1)
  immediately — check that file for the authoritative list of what is read.

## 3. Running the app

```bash
# Local development (dev overlay passed explicitly — it is NOT auto-loaded)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Production (base + prod overlay, dev overlay NOT loaded)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# No Docker: see "Local development (without Docker)" in README.md
```

- The dev overlay is `docker-compose.dev.yml`, not `docker-compose.override.yml`, so
  Compose never picks it up implicitly. A bare `docker compose up` runs the base file —
  which is the production shape — instead of silently binding dev mounts.
- The prod overlay binds Postgres and Redis to `127.0.0.1` only; the base file
  publishes them on `0.0.0.0`. Do not "fix" that by editing the base file.
- Public ports on the production host come from `.env`, not from a compose edit:
  frontend `${FRONTEND_PORT}` (nginx on 80 in-container) and API `${API_HOST_PORT}`.
  Postgres and Redis are loopback-only by design.
- Runtime state lives in `./data/postgres` and `./data/redis` (bind mounts, gitignored).
  Back it up through the container — `docker compose … exec -T postgres pg_dump …` — not
  by copying the directory: it is mode `0700`, owned by the postgres uid, so a host-side
  copy as your own user will fail or come back empty.
- `prisma migrate deploy` runs from the container entrypoint on start — do not run
  migrations by hand against production, and do not edit an already-applied
  migration under `database/prisma/migrations/`; add a new one.

### Deploys are automatic: merging to `main` ships to production

`.github/workflows/deploy.yml` runs on every push to `main`. `main` is a protected branch
(rulesets reject direct pushes and force-pushes, admins included), so a push to `main` only
ever means **a PR was merged** — that merge is the deploy trigger. There is no separate
"release" step; the PR you merge is the release.

What the workflow does: SSHes to this host and runs `/home/deploy/bin/psx-ci-deploy`, which
resets the production checkout (`/home/deploy/hermes_project/PSX_Scraper_Prod`) to
`origin/main` and execs the versioned `scripts/deploy.sh`.

- The CI SSH key is bound to a **forced command** in `~/.ssh/authorized_keys`: it cannot open
  a shell or run arbitrary commands, only cause a deploy of merged code. Don't "fix" that by
  loosening the key.
- `scripts/deploy.sh` deploys **the current checkout** and gates on `/health` returning 200 and
  on every container being running/healthy/not-OOM-killed. A failing deploy fails the workflow
  instead of going live silently.
- `docker compose up -d --build` builds all images **before** recreating anything, so a commit
  that does not compile fails the deploy and leaves the previous version serving.
- Expect ~20s of API unavailability per deploy while backend/worker/frontend are recreated.
- Re-run it from the Actions tab (`workflow_dispatch`) if a deploy needs repeating.

## 4. Before you call a change done

```bash
npm --prefix backend test        # jest (schemas, orchestrator merge, parse utils)
npm --prefix backend run lint    # eslint
npm --prefix backend run build   # tsc — type errors must be zero
```

Scraper changes are not verified by unit tests alone: Puppeteer selectors break
silently against a changed upstream page. After touching `backend/src/scrapers/`,
exercise a real scrape (add a stock through the API, or POST
`/api/v1/stocks/{symbol}/sync`) and confirm rows land in Postgres — and say in your
report that you did, or that you could not.
