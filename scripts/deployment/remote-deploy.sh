#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_SHA="${1:?Expected Git commit SHA is required}"
PROJECT_DIR="${PROJECT_DIR:-/opt/aromazen-portal}"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$PROJECT_DIR/docker-compose.prod.yml")
HEALTH_URL="https://ai.aromazenind.com/api/v1/health"

if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Invalid Git commit SHA." >&2
    exit 2
fi

exec 9>/tmp/aromazen-production-deploy.lock
if ! flock -n 9; then
    echo "Another production deployment is already running." >&2
    exit 3
fi

cd "$PROJECT_DIR"

if [[ "$(git branch --show-current)" != "main" ]]; then
    echo "Production checkout must remain on the main branch." >&2
    exit 4
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Production checkout contains uncommitted changes; deployment stopped." >&2
    exit 5
fi

echo "Creating encrypted pre-deployment backup..."
bash ./scripts/deployment/backup.sh

echo "Fetching the approved commit..."
git fetch --prune origin main
REMOTE_SHA="$(git rev-parse origin/main)"
if ! git merge-base --is-ancestor "$EXPECTED_SHA" origin/main; then
    echo "GitHub approved $EXPECTED_SHA, but it is not part of origin/main at $REMOTE_SHA; deployment stopped." >&2
    exit 6
fi

CURRENT_SHA="$(git rev-parse HEAD)"
if [[ "$CURRENT_SHA" == "$EXPECTED_SHA" ]]; then
    echo "The approved commit is already checked out."
elif git merge-base --is-ancestor "$CURRENT_SHA" "$EXPECTED_SHA"; then
    git merge --ff-only "$EXPECTED_SHA"
elif git merge-base --is-ancestor "$EXPECTED_SHA" "$CURRENT_SHA"; then
    echo "Approved commit $EXPECTED_SHA has already been superseded by deployed commit $CURRENT_SHA; skipping stale deployment."
    exit 0
else
    echo "Production commit $CURRENT_SHA cannot be safely fast-forwarded to approved commit $EXPECTED_SHA; deployment stopped." >&2
    exit 6
fi

if [[ "$(git rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
    echo "Production did not reach the exact approved commit; deployment stopped." >&2
    exit 6
fi

echo "Building and starting the approved release..."
bash ./scripts/deployment/deploy.sh

echo "Waiting for the public health endpoint..."
for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 10 "$HEALTH_URL" | grep -q '"status":"ok"'; then
        echo "Production deployment $EXPECTED_SHA is healthy."
        "${COMPOSE[@]}" ps
        exit 0
    fi
    echo "Health check attempt $attempt/30 failed; retrying in 5 seconds..."
    sleep 5
done

echo "Production health check failed after deployment." >&2
"${COMPOSE[@]}" ps >&2
"${COMPOSE[@]}" logs --tail=100 api frontend caddy >&2
exit 7
