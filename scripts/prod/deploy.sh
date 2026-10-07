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

# docker compose reads .env itself, while this script also needs the optional
# Tunnel setting and smoke-test URL.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
# 可选：实例自行维护的 Cloudflare Tunnel 覆盖文件（ADR-0060，不纳入版本控制）。
# 仅当配置了凭据目录且本地存在该 compose 文件时叠加；如何暴露公网入口由部署者决定。
if [ -n "${CLOUDFLARED_CONFIG_DIR:-}" ] && [ -f docker-compose.tunnel.yml ]; then
  compose_files+=(-f docker-compose.tunnel.yml)
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
