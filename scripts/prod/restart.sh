#!/usr/bin/env bash
# 生产重启（ADR-0047）：不带参数重启全部服务，带服务名单独重启。
#   bash scripts/prod/restart.sh          # 全部
#   bash scripts/prod/restart.sh api      # 单个（api|server|gitea）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
if [ -f docker-compose.prod.tls.yml ]; then
  compose_files+=(-f docker-compose.prod.tls.yml)
fi

docker compose "${compose_files[@]}" restart "$@"

# api 有健康检查：重启后等待其就绪再冒烟，避免留下中间态
echo "restart: waiting for api health..."
deadline=$((SECONDS + 120))
until curl -fsS -o /dev/null http://localhost:3000/health; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "restart: api did not become healthy in time" >&2
    docker compose "${compose_files[@]}" ps >&2
    exit 1
  fi
  sleep 2
done

bash scripts/prod/smoke.sh
echo "restart: done."
