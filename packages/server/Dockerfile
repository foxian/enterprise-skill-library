FROM node:20-bookworm-slim

WORKDIR /app
ARG NPM_PROXY=

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages packages

RUN unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY all_proxy && npm config delete proxy && npm config delete https-proxy && if [ -n "$NPM_PROXY" ]; then npm config set proxy "$NPM_PROXY" && npm config set https-proxy "$NPM_PROXY"; fi && npm config set registry https://registry.npmmirror.com && npm install --no-package-lock --workspace @esl/core --workspace @esl/server --include-workspace-root && npm run build --workspace @esl/core && npm run build --workspace @esl/server

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@esl/server"]
