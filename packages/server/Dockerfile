FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
RUN npm ci --workspace @esl/core --workspace @esl/server --include-workspace-root

COPY packages/core packages/core
COPY packages/server packages/server
RUN npm run build --workspace @esl/core && npm run build --workspace @esl/server

EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@esl/server"]
