#!/usr/bin/env bash
# Production smoke check (curl edition).
#
# Endpoint semantics mirror scripts/check-git-backend-maintenance-entry.mjs
# (the node edition), which the server cannot run: production hosts only have
# bash + docker. deploy.sh calls this after a deploy; it is also safe to run
# by hand:
#
#   bash scripts/prod/smoke.sh [BASE_URL]
#
# BASE_URL defaults to $1, then $ESL_SERVER_URL, then http://localhost:3000.

set -euo pipefail

BASE_URL="${1:-${ESL_SERVER_URL:-http://localhost:3000}}"
BASE_URL="${BASE_URL%/}"

fail() { echo "smoke: FAIL — $1" >&2; exit 1; }

# 1. /health: API 就绪（要求 2xx）
curl -fsSL -o /dev/null "$BASE_URL/health" || fail "GET $BASE_URL/health failed"
echo "smoke: ok  /health"

# 2. /api/auth/login: API 边界（与 node 版一致：仅要求非 5xx）
code="$(curl -sSL -o /dev/null -w '%{http_code}' "$BASE_URL/api/auth/login")" \
  || fail "GET $BASE_URL/api/auth/login connection failed"
[ "$code" -lt 500 ] || fail "GET $BASE_URL/api/auth/login returned $code"
echo "smoke: ok  /api/auth/login ($code, non-5xx)"

# 3. /git/user/login: Git Backend Maintenance Entry 页面（要求 2xx）
login_html="$(curl -fsSL "$BASE_URL/git/user/login")" \
  || fail "GET $BASE_URL/git/user/login failed"

# 4. 登录页须引用 CSS / JavaScript / 图片三类 /git/ 静态资产且可加载
# （对齐 node 版 STATIC_ASSET_TYPES 与 discoverRepresentativeAssets 语义；
#  扩展名以 ?/#/结尾为界，避免 .js 误匹配 .json）
for kind in 'css' 'js' 'svg|png|jpg|jpeg|webp'; do
  asset="$(printf '%s' "$login_html" \
    | grep -oE '(href|src)="[^"]+"' \
    | sed -E 's/^(href|src)="//; s/"$//' \
    | grep -m1 -E "^/git/[^\"']*\.($kind)([?#]|$)" || true)"
  [ -n "$asset" ] || fail "login page did not reference a $kind asset under /git/"
  curl -fsSL -o /dev/null "$BASE_URL$asset" || fail "asset $asset failed to load"
  echo "smoke: ok  asset($kind) $asset"
done

echo "smoke: Git Backend Maintenance Entry is reachable through $BASE_URL/git"
