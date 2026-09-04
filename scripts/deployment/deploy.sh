#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$PROJECT_DIR/docker-compose.prod.yml")

bash "$PROJECT_DIR/scripts/deployment/validate-env.sh"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$APP_DATA_DIR/uploads"
chmod 700 "$APP_DATA_DIR" "$APP_DATA_DIR/uploads"
chmod 600 "$ENV_FILE"

"${COMPOSE[@]}" build --pull
# Keep persistent services and the public proxy running while application
# containers are replaced. Recreating the entire stack caused avoidable outages.
if ! "${COMPOSE[@]}" up -d --wait --wait-timeout 120 postgres redis; then
    echo "Database services did not become healthy." >&2
    "${COMPOSE[@]}" ps >&2 || true
    exit 1
fi
if ! "${COMPOSE[@]}" run --rm migrations; then
    echo "Database migrations failed." >&2
    "${COMPOSE[@]}" logs --tail=200 migrations >&2 || true
    exit 1
fi
if ! "${COMPOSE[@]}" up -d --no-deps --force-recreate api; then
    echo "The API container could not be replaced." >&2
    "${COMPOSE[@]}" logs --tail=200 api >&2 || true
    exit 1
fi
for attempt in $(seq 1 30); do
    if "${COMPOSE[@]}" exec -T api python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"; then
        break
    fi
    if [[ "$attempt" -eq 30 ]]; then
        echo "The new API container did not become healthy." >&2
        "${COMPOSE[@]}" logs --tail=200 api >&2 || true
        exit 1
    fi
    sleep 2
done
if ! "${COMPOSE[@]}" up -d --no-deps --force-recreate frontend; then
    echo "The frontend container could not be replaced." >&2
    "${COMPOSE[@]}" logs --tail=200 frontend >&2 || true
    exit 1
fi
for attempt in $(seq 1 30); do
    if "${COMPOSE[@]}" exec -T frontend wget -q --spider http://localhost:3000/login; then
        break
    fi
    if [[ "$attempt" -eq 30 ]]; then
        echo "The new frontend container did not become healthy." >&2
        "${COMPOSE[@]}" logs --tail=200 frontend >&2 || true
        exit 1
    fi
    sleep 2
done
"${COMPOSE[@]}" up -d --no-deps caddy
"${COMPOSE[@]}" ps

echo
echo "Deployment started. Check https://$SITE_ADDRESS after DNS points to this server."
echo "Health endpoint: https://$SITE_ADDRESS/api/v1/health"
