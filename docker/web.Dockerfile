# syntax=docker/dockerfile:1
# ESL Server 生产镜像：前端产物与 nginx 配置烤入镜像（ADR-0047）。

# ── 构建阶段：node 环境产出 web dist ──
FROM node:20-bookworm-slim AS build

WORKDIR /app
ARG NPM_PROXY=
ARG NPM_REGISTRY=https://registry.npmmirror.com

# 先拷贝清单文件并安装依赖：源码改动不会使依赖安装层缓存失效
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/web/package.json packages/web/package.json

RUN unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY all_proxy && npm config delete proxy && npm config delete https-proxy && if [ -n "$NPM_PROXY" ]; then npm config set proxy "$NPM_PROXY" && npm config set https-proxy "$NPM_PROXY"; fi && npm config set registry "$NPM_REGISTRY" && npm install --no-package-lock --workspace @esl/core --workspace @esl/i18n --workspace @esl/web --include-workspace-root

# 再拷贝源码并按依赖顺序构建：只有这一层随代码改动失效
COPY packages packages
RUN npm run build --workspace @esl/core \
 && npm run build --workspace @esl/i18n \
 && npm run build --workspace @esl/web

# ── 运行阶段：纯 nginx，不含 node ──
FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html/admin

EXPOSE 80
