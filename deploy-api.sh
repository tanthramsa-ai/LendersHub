#!/usr/bin/env bash
# =============================================================================
#  LendersHub - API server deploy (Linux / VPS)
#
#  Pulls the latest code and rebuilds ONLY what changed:
#    - backend/**  or  docker/Dockerfile.backend  or  docker-compose.backend.yml
#         -> rebuild + restart the backend (Prisma migrations auto-apply on boot)
#    - docker/Dockerfile.db                 -> rebuild + restart postgres
#    - docker/Dockerfile.redis              -> rebuild + restart redis
#
#  Leaves Caddy (managed outside the repo) and the Vercel-hosted frontend alone.
#  Data volumes (postgres_data, redis_data) are always preserved.
#
#  Usage:
#    ./deploy-api.sh            # deploy only if git pull brought relevant changes
#    ./deploy-api.sh --force    # rebuild the backend even if nothing changed
#
#  Run from the repo root on the API server (e.g. ~/LendersHub).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. Pull latest -----------------------------------------------------------
log "Pulling latest code (fast-forward only)..."
BEFORE=$(git rev-parse HEAD)
git pull --ff-only || die "git pull failed (uncommitted changes or non-fast-forward). Resolve, then retry."
AFTER=$(git rev-parse HEAD)

if [[ "$BEFORE" == "$AFTER" && "$FORCE" -eq 0 ]]; then
  log "Already up to date ($AFTER) — nothing to deploy. Use --force to rebuild anyway."
  exit 0
fi

# --- 2. Work out what changed -------------------------------------------------
if [[ "$FORCE" -eq 1 ]]; then
  CHANGED=$'backend/\ndocker/Dockerfile.backend'   # force path: treat backend as changed
  warn "--force: rebuilding backend regardless of diff."
else
  CHANGED=$(git diff --name-only "$BEFORE" "$AFTER")
  log "Changed files:"; echo "$CHANGED" | sed 's/^/    /'
fi

match() { echo "$CHANGED" | grep -qE "$1"; }

BACKEND_CHANGED=0; DB_CHANGED=0; REDIS_CHANGED=0
match '^backend/'                 && BACKEND_CHANGED=1
match '^docker/Dockerfile\.backend' && BACKEND_CHANGED=1
match '^docker-compose\.backend\.yml' && BACKEND_CHANGED=1
match '^docker/Dockerfile\.db'    && DB_CHANGED=1
match '^docker/Dockerfile\.redis' && REDIS_CHANGED=1

if [[ "$BACKEND_CHANGED$DB_CHANGED$REDIS_CHANGED" == "000" ]]; then
  log "No backend/docker changes in this update — nothing to redeploy."
  exit 0
fi

# --- 3. Ensure the shared network exists --------------------------------------
docker network inspect lendershub-net >/dev/null 2>&1 || {
  log "Creating shared network lendershub-net..."; docker network create lendershub-net >/dev/null;
}

# --- 4. Rebuild + restart what changed ----------------------------------------
if [[ "$DB_CHANGED" -eq 1 ]]; then
  log "docker/Dockerfile.db changed -> rebuilding postgres (data volume preserved)..."
  docker compose -f docker-compose.db.yml up -d --build
fi
if [[ "$REDIS_CHANGED" -eq 1 ]]; then
  log "docker/Dockerfile.redis changed -> rebuilding redis..."
  docker compose -f docker-compose.redis.yml up -d --build
fi
if [[ "$BACKEND_CHANGED" -eq 1 ]]; then
  log "Rebuilding backend (Prisma migrations auto-apply on boot)..."
  docker compose -f docker-compose.backend.yml up -d --build
fi

# --- 5. Health check ----------------------------------------------------------
log "Waiting for backend on http://localhost:4001 ..."
for i in $(seq 1 45); do
  # any HTTP response (even 404) means the server is accepting connections
  if curl -s -o /dev/null http://localhost:4001/api/v1/super-admin/auth/login; then
    log "Backend is responding."
    docker ps --filter name=lendershub- --format '    {{.Names}}\t{{.Status}}'
    exit 0
  fi
  sleep 2
done

warn "Backend did not respond within ~90s. Check logs:  docker logs -f lendershub-backend"
exit 1
