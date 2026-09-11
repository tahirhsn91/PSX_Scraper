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
| GitHub branch protection | Server-side: rejects a push to `main`/`develop` from anyone, admins included. |
| `.githooks/pre-commit` | Local: refuses to create a commit while on `main`/`develop`. |
| `.githooks/pre-push` | Local: refuses any push whose destination ref is `main`/`develop`. |

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
# Local development (auto-loads docker-compose.override.yml: bind mounts + hot reload)
docker compose up --build

# Production (base + prod overlay, dev override NOT loaded)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# No Docker: see "Local development (without Docker)" in README.md
```

- Never run a bare `docker compose up` on a production host: it auto-loads the dev
  override (source bind mounts, debug logging, published dev ports).
- The prod overlay binds Postgres and Redis to `127.0.0.1` only; the base file
  publishes them on `0.0.0.0`. Do not "fix" that by editing the base file.
- `prisma migrate deploy` runs from the container entrypoint on start — do not run
  migrations by hand against production, and do not edit an already-applied
  migration under `database/prisma/migrations/`; add a new one.

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
