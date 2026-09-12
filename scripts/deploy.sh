#!/usr/bin/env bash
# Production deploy for the PSX Stock Scraper.
#
# Deploys THE CURRENT CHECKOUT — syncing a ref first is the caller's job:
#   * CI (.github/workflows/deploy.yml) → /home/deploy/bin/psx-ci-deploy, which resets the
#     checkout to origin/main and then execs this script.
#   * by hand:  git fetch origin && git checkout -B main origin/main && git reset --hard origin/main
#               bash scripts/deploy.sh
#
# Idempotent: safe to re-run. It gates on the API's own /health endpoint and on container
# state, and exits non-zero on any problem — so a failed deploy fails the workflow instead
# of leaving something broken silently live.
#
# Note on partial failure: `docker compose up -d --build` builds every image BEFORE it
# recreates anything, so a commit that does not compile aborts the deploy while the
# previously running containers keep serving. That is the intended safety property.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
HEALTH_URL="http://127.0.0.1:4000/health"
FRONTEND_URL="http://127.0.0.1:5173/"
HEALTH_TIMEOUT=120

COMMIT="$(git rev-parse --short HEAD)"

echo "==============================================================="
echo "[deploy] repo    : $REPO_DIR"
echo "[deploy] commit  : $COMMIT — $(git log -1 --format=%s)"
echo "[deploy] branch  : $(git rev-parse --abbrev-ref HEAD)"
echo "[deploy] dirty   : $(git status --porcelain | wc -l) changed path(s)"
echo "[deploy] started : $(date -u '+%F %T UTC')"
echo "==============================================================="

if [ ! -f .env ]; then
  echo "[deploy] ERROR: .env is missing — production configuration lives there (see .env.example)" >&2
  exit 1
fi

# Serialise deploys. The workflow's `concurrency` group only orders GitHub-triggered runs — it
# cannot stop a hand-run deploy colliding with a CI one. That is exactly what broke the first
# live run: two concurrent `compose up` calls raced and Docker rejected the second with
# "container name ... is already in use". Take a lock instead of stepping on each other.
LOCK_FILE="/tmp/psx-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[deploy] another deploy is already running (lock $LOCK_FILE) — refusing to run concurrently" >&2
  exit 4
fi
echo "[deploy] lock acquired ($LOCK_FILE)"

echo "[deploy] build + start (this recreates changed services; the API blips for ~20s)"
"${COMPOSE[@]}" up -d --build

echo "[deploy] waiting up to ${HEALTH_TIMEOUT}s for $HEALTH_URL"
healthy=false
for i in $(seq 1 "$HEALTH_TIMEOUT"); do
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[deploy] API healthy after ${i}s: $(curl -fsS -m 3 "$HEALTH_URL")"
    healthy=true
    break
  fi
  sleep 1
done
if [ "$healthy" != true ]; then
  echo "[deploy] ERROR: API did not become healthy within ${HEALTH_TIMEOUT}s — last 40 backend log lines:" >&2
  "${COMPOSE[@]}" logs --tail=40 backend >&2 || true
  exit 1
fi

ids="$("${COMPOSE[@]}" ps -q)"
if [ -z "$ids" ]; then
  echo "[deploy] ERROR: no containers are running after up — refusing to report success" >&2
  exit 1
fi

# A freshly recreated container reports health "starting" for its start_period (40s for the
# API), so a check that demands "healthy" immediately would fail every good deploy. Wait for
# the set to settle instead, and fail fast on anything genuinely wrong.
#
# `{{else}}none{{end}}` matters: containers without a healthcheck (the worker) would otherwise
# emit an empty field, shifting OOMKilled/RestartCount into the wrong variables — which is how
# the first version of this script reported a healthy worker as `health=false`.
SETTLE_TIMEOUT=120
echo "[deploy] waiting up to ${SETTLE_TIMEOUT}s for containers to settle"
settled=false
for i in $(seq 1 "$SETTLE_TIMEOUT"); do
  pending=0
  problems=""
  # shellcheck disable=SC2086  # $ids is deliberately word-split: one arg per container id
  while read -r name state health oom restarts; do
    [ -z "$name" ] && continue
    name="${name#/}"
    case "$state" in running) ;; *) problems="$problems $name(state=$state)";; esac
    case "$health" in
      healthy|none) ;;
      starting) pending=$((pending + 1)) ;;
      *) problems="$problems $name(health=$health)" ;;
    esac
    [ "$oom" = "true" ] && problems="$problems $name(OOMKilled)"
    [ "${restarts:-0}" -gt 0 ] 2>/dev/null && problems="$problems $name(restarts=$restarts)"
  done < <(docker inspect $ids --format '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.OOMKilled}} {{.RestartCount}}' 2>/dev/null)

  if [ -n "$problems" ]; then
    echo "[deploy] ERROR: containers are not well after deploy:$problems" >&2
    "${COMPOSE[@]}" ps
    exit 1
  fi
  if [ "$pending" -eq 0 ]; then
    settled=true
    echo "[deploy] all containers settled after ${i}s"
    break
  fi
  sleep 1
done

if [ "$settled" != true ]; then
  echo "[deploy] ERROR: containers still reporting 'starting' after ${SETTLE_TIMEOUT}s" >&2
  "${COMPOSE[@]}" ps
  exit 1
fi

echo "[deploy] container state:"
# shellcheck disable=SC2086
docker inspect $ids --format '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.OOMKilled}} {{.RestartCount}}' 2>/dev/null | while read -r name state health oom restarts; do
  echo "[deploy]   ${name#/}: state=$state health=$health oom=$oom restarts=$restarts"
done

frontend_code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$FRONTEND_URL" || echo 000)"
echo "[deploy] frontend: HTTP $frontend_code ($FRONTEND_URL)"
if [ "$frontend_code" != "200" ]; then
  echo "[deploy] ERROR: frontend did not return 200" >&2
  exit 1
fi

echo "[deploy] pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

echo "==============================================================="
echo "[deploy] DONE — $COMMIT live at $(date -u '+%F %T UTC')"
echo "==============================================================="
