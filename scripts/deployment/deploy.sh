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
# Recreate containers after a successful build so Docker cannot leave an older
# image running merely because the Compose service configuration is unchanged.
if ! "${COMPOSE[@]}" up -d --remove-orphans --force-recreate; then
    echo "Production containers did not become healthy. Showing startup diagnostics..." >&2
    "${COMPOSE[@]}" ps >&2 || true
    "${COMPOSE[@]}" logs --tail=200 api migrations >&2 || true
    exit 1
fi
"${COMPOSE[@]}" ps

echo
echo "Deployment started. Check https://$SITE_ADDRESS after DNS points to this server."
echo "Health endpoint: https://$SITE_ADDRESS/api/v1/health"
