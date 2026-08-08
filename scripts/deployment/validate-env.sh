#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.production.example and fill it first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required=(SITE_ADDRESS APP_DATA_DIR POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET_KEY BACKUP_ENCRYPTION_PASSWORD)
for name in "${required[@]}"; do
  value="${!name:-}"
  if [[ -z "$value" || "$value" == *CHANGE_ME* ]]; then
    echo "$name is missing or still contains CHANGE_ME." >&2
    exit 1
  fi
done

if [[ ${#POSTGRES_PASSWORD} -lt 24 || ${#REDIS_PASSWORD} -lt 24 ]]; then
  echo "Database and Redis passwords must each contain at least 24 characters." >&2
  exit 1
fi
if [[ ${#JWT_SECRET_KEY} -lt 48 ]]; then
  echo "JWT_SECRET_KEY must contain at least 48 characters." >&2
  exit 1
fi
if [[ ${#BACKUP_ENCRYPTION_PASSWORD} -lt 24 ]]; then
  echo "BACKUP_ENCRYPTION_PASSWORD must contain at least 24 characters." >&2
  exit 1
fi
if [[ -n "${BOOTSTRAP_OWNER_PASSWORD:-}" && ${#BOOTSTRAP_OWNER_PASSWORD} -lt 12 ]]; then
  echo "BOOTSTRAP_OWNER_PASSWORD must contain at least 12 characters." >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$PROJECT_DIR/docker-compose.prod.yml" config --quiet
echo "Production environment and Compose configuration are valid."
