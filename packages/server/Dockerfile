FROM node:20-bookworm-slim

WORKDIR /app
ARG NPM_PROXY=
# 镜像源可参数化（ADR-0047）：默认中国镜像源；海外服务器构建时传
# --build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com

# 先只拷贝清单文件并安装依赖：服务端源码改动不会使依赖安装层缓存失效
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json

RUN unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY all_proxy && npm config delete proxy && npm config delete https-proxy && if [ -n "$NPM_PROXY" ]; then npm config set proxy "$NPM_PROXY" && npm config set https-proxy "$NPM_PROXY"; fi && npm config set registry "$NPM_REGISTRY" && if [ "$NPM_REGISTRY" = "https://registry.npmmirror.com" ]; then export npm_config_better_sqlite3_binary_host=https://npmmirror.com/mirrors/better-sqlite3; fi && npm install --no-package-lock --workspace @esl/core --workspace @esl/i18n --workspace @esl/server --include-workspace-root

# 再拷贝源码并构建：只有这一层随代码改动失效
COPY packages packages
RUN npm run build --workspace @esl/core && npm run build --workspace @esl/i18n && npm run build --workspace @esl/server

EXPOSE 3000

# 以非 root 运行（node 镜像内置用户 node，UID 1000）：
# 容器写入 /data 的数据归 UID 1000，与宿主机部署用户一致，
# 备份/恢复脚本无需 root 即可读写持久化数据（ADR-0047 运维基线）
USER node

# 健康检查用 node 内置 fetch（slim 镜像无 curl）；server 容器据此等 api 真正就绪
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||'3000')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "--workspace", "@esl/server"]
