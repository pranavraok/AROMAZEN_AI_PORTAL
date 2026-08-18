#!/usr/bin/env bash
set -euo pipefail
umask 077

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$PROJECT_DIR/docker-compose.prod.yml")

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${APP_DATA_DIR:?APP_DATA_DIR is required}"
: "${BACKUP_ENCRYPTION_PASSWORD:?BACKUP_ENCRYPTION_PASSWORD is required}"

command -v openssl >/dev/null || { echo "OpenSSL is required." >&2; exit 1; }

BACKUP_BUCKET="${BACKUP_BUCKET:-}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DATA_DIR/backups}"
LOCAL_BACKUP_DAYS="${LOCAL_BACKUP_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RAW_FILE="$BACKUP_DIR/aromazen-$STAMP.dump"
ENCRYPTED_FILE="$RAW_FILE.enc"

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$RAW_FILE"' EXIT

"${COMPOSE[@]}" exec -T postgres pg_dump -U aromazen -d aromazen_ai -Fc > "$RAW_FILE"
test -s "$RAW_FILE"

openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in "$RAW_FILE" -out "$ENCRYPTED_FILE" \
  -pass env:BACKUP_ENCRYPTION_PASSWORD
test -s "$ENCRYPTED_FILE"

if [[ -n "$BACKUP_BUCKET" ]]; then
  command -v aws >/dev/null || { echo "AWS CLI is required when BACKUP_BUCKET is configured." >&2; exit 1; }
  aws s3 cp "$ENCRYPTED_FILE" "s3://$BACKUP_BUCKET/database/$(basename "$ENCRYPTED_FILE")" --only-show-errors
  aws s3 sync "$APP_DATA_DIR/uploads" "s3://$BACKUP_BUCKET/uploads/current" --only-show-errors
  echo "Encrypted database and uploaded files copied to private object storage."
else
  echo "WARNING: BACKUP_BUCKET is empty; this backup exists only on the application server." >&2
  echo "Configure private object storage later to protect against complete server or disk loss." >&2
fi

find "$BACKUP_DIR" -type f -name 'aromazen-*.dump.enc' -mtime "+$LOCAL_BACKUP_DAYS" -delete
echo "Encrypted database backup created successfully at $STAMP: $ENCRYPTED_FILE"
