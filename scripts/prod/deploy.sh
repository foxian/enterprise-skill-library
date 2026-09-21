#!/usr/bin/env bash
# 生产部署（ADR-0047）：构建镜像 → 重建容器并等待健康 → 冒烟验证。
#
# 用法：git pull 到目标版本后，在仓库根目录执行
#   bash scripts/prod/deploy.sh
#
# 服务器前置依赖：Docker + git（无 node）。对外地址等配置在 .env。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
# enable-tls.sh 启用 HTTPS 后会生成该片段；存在即叠加
if [ -f docker-compose.prod.tls.yml ]; then
  compose_files+=(-f docker-compose.prod.tls.yml)
fi

on_error() {
  echo "deploy: FAILED — recent container logs:" >&2
  docker compose "${compose_files[@]}" logs --tail 50 api server gitea >&2 || true
}
trap on_error ERR

echo "deploy: building images (api + web)..."
docker compose "${compose_files[@]}" build

echo "deploy: recreating containers and waiting for health..."
docker compose "${compose_files[@]}" up -d --wait --wait-timeout 300

echo "deploy: running smoke checks..."
bash scripts/prod/smoke.sh

echo "deploy: done — stack is up and healthy."
