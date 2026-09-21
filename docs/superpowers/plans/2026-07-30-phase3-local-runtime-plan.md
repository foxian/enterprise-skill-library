# Phase 3 Local Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 2 API Server runnable in a local Docker Compose environment and verify host CLI `login`, `search`, and `info` against local services.

**Architecture:** Keep reusable runtime/config/seed logic in `packages/server`; keep CLI behavior unchanged except where smoke verification exposes a blocker. Docker Compose runs Gitea and API Server, while the CLI runs on the host with `npm exec -- esl ...`.

**Tech Stack:** Node.js >= 18.0.0, npm workspaces, TypeScript strict ESM, Fastify, Gitea REST API, SQLite (`better-sqlite3`), Docker Compose, Vitest.

## Global Constraints

- Follow [docs/agent-coding-principles.md](../../agent-coding-principles.md).
- Keep reusable logic in `packages/core`; keep CLI parsing, output, and exit behavior in `packages/cli`.
- Keep Phase 3 scope limited to server runtime, Docker Compose local environment, seed data, docs, and `login/search/info` smoke verification.
- Do not implement real `esl publish` or `esl install` end-to-end Git HTTP workflows in this phase.
- Verify changes with `npm test` and `npm run build`.
- Preserve unrelated working tree changes.

---

## File Structure

- `packages/server/src/config.ts`: Parse and validate API Server environment configuration.
- `packages/server/tests/config.test.ts`: Unit tests for environment parsing.
- `packages/server/src/app.ts`: Register `/health` in the existing Fastify app.
- `packages/server/tests/app.test.ts`: Add `/health` route test.
- `packages/server/src/server.ts`: Runtime entry that starts Fastify.
- `packages/server/tests/server.test.ts`: Tests runtime wiring without binding a real port.
- `packages/server/src/seed.ts`: Idempotent development seed logic and CLI entry.
- `packages/server/tests/seed.test.ts`: Seed idempotency tests.
- `packages/server/package.json`: Add `start` and `seed` scripts.
- `packages/server/Dockerfile`: Container image for API Server.
- `docker-compose.yml`: Local Gitea and API Server services.
- `.env.example`: Local environment template.
- `docs/local-dev.md`: Copy-pasteable Docker Compose and CLI smoke workflow.

---

### Task 1: Server Configuration and Health Endpoint

**Files:**
- Create: `packages/server/src/config.ts`
- Create: `packages/server/tests/config.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/tests/app.test.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Produces: `ServerConfig`, `loadServerConfig(env?: NodeJS.ProcessEnv): ServerConfig`
- Produces: `GET /health` returning `{ ok: true, service: 'esl-api' }`
- Consumes: Existing `buildApp(options: AppOptions): FastifyInstance`

- [ ] **Step 1: Write failing config tests**

Append `packages/server/tests/config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../src/config.js';

describe('server config', () => {
  it('loads required environment variables and defaults PORT to 3000', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token'
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      port: 3000,
      databasePath: '/tmp/esl.db',
      giteaUrl: 'http://gitea:3000',
      giteaAdminToken: 'admin-token'
    });
  });

  it('throws a clear error for missing required variables', () => {
    expect(() => loadServerConfig({} as NodeJS.ProcessEnv)).toThrow(
      'Missing required environment variable: DATABASE_PATH'
    );
  });
});
```

- [ ] **Step 2: Run config test to verify failure**

Run: `npx vitest run packages/server/tests/config.test.ts`

Expected: FAIL with missing `../src/config.js`.

- [ ] **Step 3: Implement config parser**

Create `packages/server/src/config.ts`:

```typescript
export interface ServerConfig {
  port: number;
  databasePath: string;
  giteaUrl: string;
  giteaAdminToken: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const portRaw = env.PORT ?? '3000';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  return {
    port,
    databasePath: requireEnv(env, 'DATABASE_PATH'),
    giteaUrl: requireEnv(env, 'GITEA_URL'),
    giteaAdminToken: requireEnv(env, 'GITEA_ADMIN_TOKEN')
  };
}
```

- [ ] **Step 4: Export config module**

Modify `packages/server/src/index.ts`:

```typescript
export * from './app.js';
export * from './config.js';
export * from './db/database.js';
export * from './db/schema.js';
export * from './routes/skills.js';
export * from './services/gitea.js';
```

- [ ] **Step 5: Run config test to verify pass**

Run: `npx vitest run packages/server/tests/config.test.ts`

Expected: PASS, 2 tests passed.

- [ ] **Step 6: Write failing health route test**

Add to `packages/server/tests/app.test.ts` inside the existing `describe` block:

```typescript
  it('responds to health checks without requiring Gitea', async () => {
    const mockGitea = {
      validateToken: vi.fn(),
      createRepo: vi.fn()
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any });

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'esl-api' });
    expect(mockGitea.validateToken).not.toHaveBeenCalled();
  });
```

- [ ] **Step 7: Run app test to verify health test fails**

Run: `npx vitest run packages/server/tests/app.test.ts`

Expected: FAIL with `404` for `/health`.

- [ ] **Step 8: Implement `/health`**

Modify `packages/server/src/app.ts` so `buildApp` registers the health route before returning:

```typescript
  app.get('/health', async () => ({ ok: true, service: 'esl-api' }));
```

Keep existing skills routes and `onClose` hook unchanged.

- [ ] **Step 9: Run focused tests**

Run: `npx vitest run packages/server/tests/config.test.ts packages/server/tests/app.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/config.ts packages/server/src/index.ts packages/server/src/app.ts packages/server/tests/config.test.ts packages/server/tests/app.test.ts
git commit -m "feat(server): add runtime config and health endpoint"
```

---

### Task 2: API Server Runtime Entry

**Files:**
- Create: `packages/server/src/server.ts`
- Create: `packages/server/tests/server.test.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: `loadServerConfig(env?: NodeJS.ProcessEnv): ServerConfig`
- Consumes: `buildApp({ dbPath, giteaService }): FastifyInstance`
- Produces: `startServer(options?: StartServerOptions): Promise<FastifyInstance>`

- [ ] **Step 1: Write failing runtime wiring test**

Create `packages/server/tests/server.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../src/server.js';

describe('server runtime', () => {
  it('starts Fastify with env config and injected listen behavior', async () => {
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');
    const app = await startServer({
      env: {
        PORT: '3999',
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token'
      } as NodeJS.ProcessEnv,
      listen
    });

    expect(listen).toHaveBeenCalledWith({ port: 3999, host: '0.0.0.0' });
    await app.close();
  });
});
```

- [ ] **Step 2: Run runtime test to verify failure**

Run: `npx vitest run packages/server/tests/server.test.ts`

Expected: FAIL with missing `../src/server.js`.

- [ ] **Step 3: Implement runtime entry**

Create `packages/server/src/server.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';
import { loadServerConfig } from './config.js';
import { GiteaService } from './services/gitea.js';

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  listen?: FastifyInstance['listen'];
}

export async function startServer(options: StartServerOptions = {}): Promise<FastifyInstance> {
  const config = loadServerConfig(options.env);
  const app = buildApp({
    dbPath: config.databasePath,
    giteaService: new GiteaService(config.giteaUrl, config.giteaAdminToken)
  });

  const listen = options.listen?.bind(app) ?? app.listen.bind(app);
  await listen({ port: config.port, host: '0.0.0.0' });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
    .then(() => {
      console.log('ESL API Server started');
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
```

- [ ] **Step 4: Add package scripts**

Modify `packages/server/package.json` scripts:

```json
"scripts": {
  "build": "tsc",
  "start": "node ./dist/server.js"
}
```

- [ ] **Step 5: Run runtime test**

Run: `npx vitest run packages/server/tests/server.test.ts`

Expected: PASS.

- [ ] **Step 6: Run server build**

Run: `npm run build --workspace @esl/server`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/server.ts packages/server/tests/server.test.ts packages/server/package.json
git commit -m "feat(server): add API server runtime entry"
```

---

### Task 3: Development Seed Script

**Files:**
- Create: `packages/server/src/seed.ts`
- Create: `packages/server/tests/seed.test.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: `initDatabase(dbPath: string): Database.Database`
- Consumes: `SkillRepository`
- Produces: `seedDevelopmentData(dbPath: string): void`
- Produces: `npm run seed --workspace @esl/server`

- [ ] **Step 1: Write failing seed idempotency test**

Create `packages/server/tests/seed.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, SkillRepository } from '../src/db/database.js';
import { seedDevelopmentData } from '../src/seed.js';

describe('development seed', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-seed-'));
    dbPath = path.join(tmpDir, 'seed.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds sample skill metadata idempotently', () => {
    seedDevelopmentData(dbPath);
    seedDevelopmentData(dbPath);

    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);
    const skill = repo.getSkill('@myorg/my-skill');

    expect(skill).toEqual({
      name: '@myorg/my-skill',
      scope: 'myorg',
      skillName: 'my-skill',
      description: 'Sample seeded skill',
      author: 'dev',
      visibility: 'public',
      gitRepoPath: 'myorg/my-skill'
    });
    expect(repo.getVersions('@myorg/my-skill')).toEqual(['0.1.0']);
    db.close();
  });
});
```

- [ ] **Step 2: Run seed test to verify failure**

Run: `npx vitest run packages/server/tests/seed.test.ts`

Expected: FAIL with missing `../src/seed.js`.

- [ ] **Step 3: Implement seed logic**

Create `packages/server/src/seed.ts`:

```typescript
import { initDatabase, SkillRepository } from './db/database.js';
import { pathToFileURL } from 'node:url';

const sampleSkill = {
  name: '@myorg/my-skill',
  scope: 'myorg',
  skillName: 'my-skill',
  description: 'Sample seeded skill',
  author: 'dev',
  visibility: 'public',
  gitRepoPath: 'myorg/my-skill'
};

export function seedDevelopmentData(dbPath: string): void {
  const db = initDatabase(dbPath);
  const repo = new SkillRepository(db);
  try {
    if (!repo.getSkill(sampleSkill.name)) {
      repo.createSkill(sampleSkill);
    }
    if (!repo.getVersions(sampleSkill.name).includes('0.1.0')) {
      repo.addVersion(sampleSkill.name, '0.1.0');
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.env.DATABASE_PATH;
  if (!dbPath) {
    console.error('Missing required environment variable: DATABASE_PATH');
    process.exitCode = 1;
  } else {
    seedDevelopmentData(dbPath);
    console.log('Seeded development skill metadata');
  }
}
```

- [ ] **Step 4: Add seed script**

Modify `packages/server/package.json` scripts:

```json
"scripts": {
  "build": "tsc",
  "start": "node ./dist/server.js",
  "seed": "node ./dist/seed.js"
}
```

- [ ] **Step 5: Run seed tests**

Run: `npx vitest run packages/server/tests/seed.test.ts`

Expected: PASS.

- [ ] **Step 6: Run server build**

Run: `npm run build --workspace @esl/server`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/seed.ts packages/server/tests/seed.test.ts packages/server/package.json
git commit -m "feat(server): add development seed script"
```

---

### Task 4: Docker Compose Local Runtime and Documentation

**Files:**
- Create: `packages/server/Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `docs/local-dev.md`

**Interfaces:**
- Consumes: `npm run start --workspace @esl/server`
- Consumes: `npm run seed --workspace @esl/server`
- Produces: local API at `http://localhost:3000`
- Produces: local Gitea at `http://localhost:3001`

- [ ] **Step 1: Write Dockerfile**

Create `packages/server/Dockerfile`:

```dockerfile
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
```

- [ ] **Step 2: Write Compose file**

Create `docker-compose.yml`:

```yaml
services:
  gitea:
    image: gitea/gitea:1.22
    ports:
      - "3001:3000"
    volumes:
      - gitea-data:/data
    environment:
      GITEA__database__DB_TYPE: sqlite3
      GITEA__server__ROOT_URL: http://localhost:3001/
      GITEA__server__HTTP_PORT: "3000"

  api:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      DATABASE_PATH: /data/esl.db
      GITEA_URL: http://gitea:3000
      GITEA_ADMIN_TOKEN: ${GITEA_ADMIN_TOKEN}
    volumes:
      - api-data:/data
    depends_on:
      - gitea

volumes:
  gitea-data:
  api-data:
```

- [ ] **Step 3: Write env template**

Create `.env.example`:

```dotenv
GITEA_ADMIN_TOKEN=replace-with-local-gitea-admin-token
DATABASE_PATH=./data/esl.db
```

- [ ] **Step 4: Write local dev docs**

Create `docs/local-dev.md`:

````markdown
# Local Development Runtime

## Prerequisites

- Node.js 18+
- npm
- Docker Desktop
- Git for Windows

## Start Services

Copy `.env.example` to `.env` and set `GITEA_ADMIN_TOKEN` after creating a local Gitea admin token.

```powershell
npm run build
docker compose up --build
```

Open Gitea at `http://localhost:3001`, complete first-run setup, create a user, and create a personal access token.

## Seed Metadata

Run the seed script against the API database path used by Docker Compose:

```powershell
docker compose exec api npm run seed --workspace @esl/server
```

## CLI Smoke

```powershell
npm exec -- esl login --registry http://localhost:3000/api --git-base http://localhost:3001 --username <user> --token <token>
npm exec -- esl search my-skill --registry http://localhost:3000/api
npm exec -- esl info @myorg/my-skill --registry http://localhost:3000/api
```

`publish` and `install` are not part of the Phase 3 smoke path.
````

- [ ] **Step 5: Validate Compose config**

Run: `docker compose config`

Expected: Command exits 0 and prints normalized Compose configuration. If `.env` is absent, create a local `.env` copied from `.env.example` and set `GITEA_ADMIN_TOKEN=local-config-check-token` for config validation.

- [ ] **Step 6: Commit**

```bash
git add packages/server/Dockerfile docker-compose.yml .env.example docs/local-dev.md
git commit -m "chore: add local Docker Compose runtime"
```

---

### Task 5: Final Verification and Smoke Checklist

**Files:**
- Modify: `docs/local-dev.md`

**Interfaces:**
- Consumes: all prior Phase 3 tasks
- Produces: documented verification evidence and any final doc corrections

- [ ] **Step 1: Run full automated verification**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Start local runtime**

Run: `docker compose up --build`

Expected: `api` and `gitea` services start. Leave this process running for the next steps.

- [ ] **Step 3: Verify health endpoint**

In a second terminal, run:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected response:

```powershell
ok service
-- -------
True esl-api
```

- [ ] **Step 4: Seed metadata**

Run:

```powershell
docker compose exec api npm run seed --workspace @esl/server
```

Expected output includes:

```text
Seeded development skill metadata
```

- [ ] **Step 5: Verify CLI search**

Run:

```powershell
npm exec -- esl search my-skill --registry http://localhost:3000/api
```

Expected output includes:

```text
@myorg/my-skill
```

- [ ] **Step 6: Verify CLI info**

Run:

```powershell
npm exec -- esl info @myorg/my-skill --registry http://localhost:3000/api
```

Expected output includes:

```json
"name": "@myorg/my-skill"
```

- [ ] **Step 7: Verify CLI login manually**

Create a Gitea user and token in `http://localhost:3001`, then run:

```powershell
npm exec -- esl login --registry http://localhost:3000/api --git-base http://localhost:3001 --username <user> --token <token>
```

Expected output:

```text
Logged in as <user>
```

- [ ] **Step 8: Update docs if smoke commands differ**

If any command differs from `docs/local-dev.md`, update that document with the exact verified command.

- [ ] **Step 9: Final verification**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 10: Commit final doc corrections**

If `docs/local-dev.md` changed:

```bash
git add docs/local-dev.md
git commit -m "docs: update local runtime smoke workflow"
```

If no files changed, record that no final commit was needed in the task report.
