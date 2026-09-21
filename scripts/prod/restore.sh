#!/usr/bin/env bash
# 生产恢复（ADR-0047 / CONTEXT.md「恢复 Restore」）：从 backup.sh 归档
# 将持久数据回退到备份时刻状态。停服操作，是备份的逆操作。
#
# 用法：
#   bash scripts/prod/restore.sh backups/esl-backup-<TS>.tar.gz --yes
#
# 缺归档参数或缺 --yes 一律拒绝。执行前先对当前状态打一次"恢复前快照"
# （best-effort），恢复操作本身失败时仍有退路。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "restore: usage: $0 <esl-backup-*.tar.gz> --yes" >&2
  exit 1
fi
if [ "${2:-}" != "--yes" ]; then
  echo "restore: refusing to restore without explicit --yes (destructive)." >&2
  exit 1
fi

DATA_DIR="${ESL_DATA_DIR:-./data}"
if [ -z "${ESL_DATA_DIR:-}" ] && [ -f .env ]; then
  DATA_DIR="$(grep -E '^ESL_DATA_DIR=' .env | tail -1 | cut -d= -f2- || true)"
  DATA_DIR="${DATA_DIR:-./data}"
fi

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
if [ -f docker-compose.prod.tls.yml ]; then
  compose_files+=(-f docker-compose.prod.tls.yml)
fi
compose() { docker compose "${compose_files[@]}" "$@"; }

echo "restore: taking a pre-restore snapshot of the current state (best-effort)..."
if ! bash scripts/prod/backup.sh; then
  echo "restore: WARNING — pre-restore snapshot failed; continuing (--yes was given)." >&2
fi

echo "restore: verifying archive contents..."
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGING"
for required in esl.db gitea secrets; do
  [ -e "$STAGING/$required" ] || { echo "restore: archive missing $required — not an esl-backup archive?" >&2; exit 1; }
done

echo "restore: stopping the stack..."
compose down

echo "restore: replacing persistent data under $DATA_DIR ..."
rm -rf "$DATA_DIR/api" "$DATA_DIR/gitea" "$DATA_DIR/secrets"
mkdir -p "$DATA_DIR/api"
mv "$STAGING/esl.db" "$DATA_DIR/api/esl.db"
[ -d "$STAGING/packages" ] && mv "$STAGING/packages" "$DATA_DIR/api/packages"
mv "$STAGING/gitea" "$DATA_DIR/gitea"
mv "$STAGING/secrets" "$DATA_DIR/secrets"
if [ -f "$STAGING/env" ]; then
  cp "$STAGING/env" .env
  chmod 600 .env
fi

echo "restore: starting the stack and waiting for health..."
compose up -d --wait --wait-timeout 300

echo "restore: running smoke checks..."
bash scripts/prod/smoke.sh

echo "restore: done — data restored from $ARCHIVE."
