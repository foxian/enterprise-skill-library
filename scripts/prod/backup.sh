#!/usr/bin/env bash
# 生产备份（ADR-0047 / CONTEXT.md「备份 Backup」）：单文件归档，恢复用
# scripts/prod/restore.sh。
#
# 用法：
#   bash scripts/prod/backup.sh                 # 立即备份一次
#   bash scripts/prod/backup.sh --install-cron  # 安装每晚 03:00 定时备份
#
# 一致性策略：API SQLite 经 better-sqlite3 执行 VACUUM INTO 得到快照点一致的
# 副本（服务不中断）；Gitea 的 SQLite 无独立 CLI 可用，短暂 stop gitea 容器
# 后整目录复制（API/Web 持续服务，仅 git push 暂停数秒——已知的务实权衡）。
# 归档含 esl.db 快照、技能包、Gitea 全部数据（仓库/组织/用户）、Bootstrap
# 机密与 .env（含秘密：backups/ 目录须保持 600，归档不得外传）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

RETENTION_DAYS=14

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)

if [ "${1:-}" = "--install-cron" ]; then
  mkdir -p backups
  # 幂等：先移除旧条目再追加
  (crontab -l 2>/dev/null | grep -v 'esl.*backup\.sh' || true;
   echo "0 3 * * * cd '$REPO_ROOT' && bash scripts/prod/backup.sh >> '$REPO_ROOT/backups/cron.log' 2>&1") | crontab -
  echo "backup: nightly cron installed (03:00, retention ${RETENTION_DAYS}d). Verify with: crontab -l"
  exit 0
fi

TS="$(date +%Y%m%d-%H%M%S)"
DATA_DIR="${ESL_DATA_DIR:-./data}"
# .env 可能覆盖 ESL_DATA_DIR（compose 以 .env 为变量源，与之一致）
if [ -z "${ESL_DATA_DIR:-}" ] && [ -f .env ]; then
  DATA_DIR="$(grep -E '^ESL_DATA_DIR=' .env | tail -1 | cut -d= -f2- || true)"
  DATA_DIR="${DATA_DIR:-./data}"
fi
[ -d "$DATA_DIR/api" ] || { echo "backup: $DATA_DIR/api not found — wrong data dir?" >&2; exit 1; }

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
mkdir -p backups

compose() { docker compose "${compose_files[@]}" "$@"; }
api_cid() { compose ps -q api; }

echo "backup: snapshotting API SQLite (VACUUM INTO)..."
compose exec -T api node -e "const db=require('better-sqlite3')(process.env.DATABASE_PATH); db.exec(\"VACUUM INTO '/data/esl.db.snapshot-$TS'\");"
docker cp "$(api_cid)":/data/esl.db.snapshot-"$TS" "$STAGING/esl.db"
compose exec -T api rm "/data/esl.db.snapshot-$TS"

echo "backup: copying uploaded packages..."
docker cp "$(api_cid)":/data/packages "$STAGING/packages"

echo "backup: copying Gitea data (brief gitea pause for consistency)..."
compose stop gitea >/dev/null
cp -r "$DATA_DIR/gitea" "$STAGING/gitea"
compose start gitea >/dev/null

echo "backup: copying bootstrap secrets..."
cp -r "$DATA_DIR/secrets" "$STAGING/secrets"

if [ -f .env ]; then
  echo "backup: including .env (secrets!)..."
  cp .env "$STAGING/env"
fi

ARCHIVE="backups/esl-backup-$TS.tar.gz"
tar -czf "$ARCHIVE" -C "$STAGING" .
chmod 600 "$ARCHIVE"

echo "backup: pruning archives older than ${RETENTION_DAYS} days..."
find backups -name 'esl-backup-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "backup: done → $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
