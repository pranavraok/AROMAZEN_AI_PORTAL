#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  echo "Usage: RESTORE_CONFIRM=RESTORE_AROMAZEN $0 /path/to/aromazen-....dump.enc" >&2
  exit 1
fi
if [[ "${RESTORE_CONFIRM:-}" != "RESTORE_AROMAZEN" ]]; then
  echo "Restore cancelled. Set RESTORE_CONFIRM=RESTORE_AROMAZEN after verifying the backup and target server." >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$PROJECT_DIR/docker-compose.prod.yml")
ENCRYPTED_FILE="$(realpath "$1")"

[[ -f "$ENCRYPTED_FILE" ]] || { echo "Backup file not found." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${BACKUP_ENCRYPTION_PASSWORD:?BACKUP_ENCRYPTION_PASSWORD is required}"

RAW_FILE="$(mktemp /tmp/aromazen-restore-XXXXXX.dump)"
trap 'rm -f "$RAW_FILE"' EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$ENCRYPTED_FILE" -out "$RAW_FILE" \
  -pass env:BACKUP_ENCRYPTION_PASSWORD
test -s "$RAW_FILE"

"${COMPOSE[@]}" stop caddy frontend api
"${COMPOSE[@]}" exec -T postgres psql -U aromazen -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'aromazen_ai' AND pid <> pg_backend_pid();"
"${COMPOSE[@]}" exec -T postgres dropdb -U aromazen --if-exists aromazen_ai
"${COMPOSE[@]}" exec -T postgres createdb -U aromazen aromazen_ai
"${COMPOSE[@]}" exec -T postgres pg_restore -U aromazen -d aromazen_ai --no-owner --no-privileges < "$RAW_FILE"
"${COMPOSE[@]}" run --rm migrations
"${COMPOSE[@]}" up -d api frontend caddy

echo "Database restore completed. Verify Super Admin, HR and R&D workflows before reopening normal use."
