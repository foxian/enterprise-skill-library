#!/bin/sh
set -eu

GITEA_URL="${GITEA_URL:-http://gitea:3000}"
GITEA_ADMIN_USERNAME="${GITEA_ADMIN_USERNAME:-eslroot}"
GITEA_ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD:-}"
GITEA_ADMIN_TOKEN_FILE="${GITEA_ADMIN_TOKEN_FILE:-/bootstrap/gitea-admin-token}"

if [ -z "$GITEA_ADMIN_PASSWORD" ]; then
  echo "Missing GITEA_ADMIN_PASSWORD" >&2
  exit 1
fi

if [ "${#GITEA_ADMIN_PASSWORD}" -lt 12 ]; then
  echo "GITEA_ADMIN_PASSWORD must be at least 12 characters" >&2
  exit 1
fi

if [ "$GITEA_ADMIN_PASSWORD" = "change-this-admin-password" ]; then
  echo "GITEA_ADMIN_PASSWORD must not use the example value" >&2
  exit 1
fi

until wget -q -O /dev/null "$GITEA_URL/api/v1/version"; do
  sleep 2
done

mkdir -p "$(dirname "$GITEA_ADMIN_TOKEN_FILE")"

if ! su-exec git gitea admin user list --admin | awk '{print $2}' | grep -Fxq "$GITEA_ADMIN_USERNAME"; then
  su-exec git gitea admin user create \
    --username "$GITEA_ADMIN_USERNAME" \
    --password "$GITEA_ADMIN_PASSWORD" \
    --email "${GITEA_ADMIN_USERNAME}@local.esl" \
    --admin \
    --must-change-password=false
fi

if [ ! -s "$GITEA_ADMIN_TOKEN_FILE" ]; then
  token_name="esl-bootstrap-$(date +%s)"
  token="$(su-exec git gitea admin user generate-access-token --username "$GITEA_ADMIN_USERNAME" --token-name "$token_name" --raw --scopes all)"
  printf '%s\n' "$token" > "$GITEA_ADMIN_TOKEN_FILE"
fi
