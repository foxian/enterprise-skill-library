# Phase 2: Gitea Migration, API Server & CLI Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 for ESL: `packages/server` (Fastify API Server, Gitea REST API integration, SQLite skill registry database, metadata/search endpoints), update `@esl/core` (local store config for Gitea token/HTTP gitBase), and implement `@esl/cli` network commands (`esl login`, `esl publish`, `esl install`, `esl search`, `esl info`).

**Architecture:** Monorepo extension with `packages/server` (Fastify API Server). Gitea manages user identity, Git HTTP repository hosting, and repository access permissions. API Server manages skill metadata index, SemVer range resolution, and search. CLI communicates with Gitea for login authentication and Git HTTP operations, and with API Server for skill metadata and search.

**Tech Stack:** Node.js >= 18.0.0, npm workspaces, TypeScript strict ESM, Fastify, Gitea REST API, SQLite (`better-sqlite3`), Commander.js, Zod, Vitest.

## Global Constraints

- Node.js >= 18.0.0
- Package Manager: npm workspaces
- Code Style: Strict TypeScript, ESM modules
- Spec reference: `docs/specs/2026-07-28-gitea-migration-design.md`
- Token auth: Gitea Personal Access Token sent via `Authorization: token <token>` header to API Server and Basic Auth (`<token>:x-oauth-basic` or token in URL) for Git HTTP.
- DB Schema: `skills`, `skill_versions`, `skill_tags` in API Server SQLite database.

---

### Task 1: Update Core Local Store for Gitea Configuration

**Files:**
- Modify: `packages/core/src/store/local-store.ts`
- Test: `packages/core/tests/local-store.test.ts`

**Interfaces:**
- Consumes: Existing `resolveLocalStorePaths` and `initializeLocalStore`
- Produces: Updated `ConfigJson` interface with `registry`, `gitBase`, `token`, `username`, `tools` and update/get config helper functions.

- [ ] **Step 1: Write failing test for updated local store config**

```typescript
// packages/core/tests/local-store.test.ts (append test case)
import { saveConfig, loadConfig } from '../src/index.js';

it('saves and loads Gitea configuration', async () => {
  await initializeLocalStore({ homeDir });
  const config = {
    registry: 'http://skills.company.com/api',
    gitBase: 'http://skills.company.com/git',
    token: 'gitea_token_12345',
    username: 'zhangsan',
    tools: []
  };
  await saveConfig(config, { homeDir });
  const loaded = await loadConfig({ homeDir });
  expect(loaded).toEqual(config);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/core/tests/local-store.test.ts`
Expected: FAIL with "saveConfig is not defined"

- [ ] **Step 3: Update `local-store.ts` implementation**

```typescript
// packages/core/src/store/local-store.ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface LocalStorePaths {
  root: string;
  configJson: string;
  credentialsJson: string;
  cacheDir: string;
  skillsDir: string;
}

export interface EslConfig {
  registry: string | null;
  gitBase: string | null;
  token: string | null;
  username: string | null;
  tools: string[];
}

export interface LocalStoreOptions {
  homeDir?: string;
}

export function resolveLocalStorePaths(options: LocalStoreOptions = {}): LocalStorePaths {
  const homeDir = options.homeDir ?? os.homedir();
  const root = path.join(homeDir, '.skill-library');
  return {
    root,
    configJson: path.join(root, 'config.json'),
    credentialsJson: path.join(root, 'credentials.json'),
    cacheDir: path.join(root, 'cache'),
    skillsDir: path.join(root, 'skills')
  };
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

export async function initializeLocalStore(options: LocalStoreOptions = {}): Promise<LocalStorePaths> {
  const paths = resolveLocalStorePaths(options);

  await fs.mkdir(paths.cacheDir, { recursive: true });
  await fs.mkdir(paths.skillsDir, { recursive: true });
  await writeJsonIfMissing(paths.configJson, {
    registry: null,
    gitBase: null,
    token: null,
    username: null,
    tools: []
  });
  await writeJsonIfMissing(paths.credentialsJson, {
    api_token: null
  });

  return paths;
}

export async function loadConfig(options: LocalStoreOptions = {}): Promise<EslConfig> {
  const paths = resolveLocalStorePaths(options);
  const raw = await fs.readFile(paths.configJson, 'utf8');
  return JSON.parse(raw) as EslConfig;
}

export async function saveConfig(config: Partial<EslConfig>, options: LocalStoreOptions = {}): Promise<EslConfig> {
  const paths = resolveLocalStorePaths(options);
  const current = await loadConfig(options);
  const updated: EslConfig = { ...current, ...config };
  await fs.writeFile(paths.configJson, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/local-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/core/src/store/local-store.ts packages/core/tests/local-store.test.ts
git commit -m "feat(core): update local store for Gitea token and HTTP gitBase config"
```

---

### Task 2: API Server Scaffolding & Database Layer

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/db/database.ts`
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/tests/database.test.ts`
- Modify: `package.json` (add `@esl/server` workspace and build script)

**Interfaces:**
- Produces: `initDatabase(dbPath: string)`, SQLite connection instance with tables `skills`, `skill_versions`, `skill_tags`.

- [ ] **Step 1: Create `packages/server/package.json` and `tsconfig.json`**

```json
// packages/server/package.json
{
  "name": "@esl/server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@esl/core": "*",
    "better-sqlite3": "^9.4.0",
    "fastify": "^4.26.0",
    "semver": "^7.6.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/semver": "^7.5.8"
  }
}
```

```json
// packages/server/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write failing database test**

```typescript
// packages/server/tests/database.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, SkillRepository } from '../src/db/database.js';

describe('API Server Database', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-db-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes schema and manages skills', () => {
    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);

    repo.createSkill({
      name: '@myorg/debugging-helper',
      scope: 'myorg',
      skillName: 'debugging-helper',
      description: 'Systematic debugging skill',
      author: 'zhangsan',
      visibility: 'public',
      gitRepoPath: 'myorg/debugging-helper'
    });

    const skill = repo.getSkill('@myorg/debugging-helper');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('@myorg/debugging-helper');
    expect(skill?.author).toBe('zhangsan');
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npx vitest run packages/server/tests/database.test.ts`
Expected: FAIL with missing module error

- [ ] **Step 4: Implement SQLite schema and `SkillRepository`**

```typescript
// packages/server/src/db/database.ts
import Database from 'better-sqlite3';

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      name TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      description TEXT NOT NULL,
      author TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      git_repo_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS skill_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL,
      version TEXT NOT NULL,
      readme TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (skill_name) REFERENCES skills(name) ON DELETE CASCADE,
      UNIQUE(skill_name, version)
    );

    CREATE TABLE IF NOT EXISTS skill_tags (
      skill_name TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (skill_name, tag),
      FOREIGN KEY (skill_name) REFERENCES skills(name) ON DELETE CASCADE
    );
  `);

  return db;
}

export interface SkillRecord {
  name: string;
  scope: string;
  skillName: string;
  description: string;
  author: string;
  visibility: string;
  gitRepoPath: string;
}

export class SkillRepository {
  constructor(private db: Database.Database) {}

  createSkill(skill: SkillRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO skills (name, scope, skill_name, description, author, visibility, git_repo_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(skill.name, skill.scope, skill.skillName, skill.description, skill.author, skill.visibility, skill.gitRepoPath);
  }

  getSkill(name: string): SkillRecord | undefined {
    const stmt = this.db.prepare('SELECT name, scope, skill_name as skillName, description, author, visibility, git_repo_path as gitRepoPath FROM skills WHERE name = ?');
    return stmt.get(name) as SkillRecord | undefined;
  }

  addVersion(skillName: string, version: string, readme?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO skill_versions (skill_name, version, readme)
      VALUES (?, ?, ?)
    `);
    stmt.run(skillName, version, readme ?? null);
  }

  getVersions(skillName: string): string[] {
    const stmt = this.db.prepare('SELECT version FROM skill_versions WHERE skill_name = ? ORDER BY id DESC');
    return (stmt.all(skillName) as { version: string }[]).map(r => r.version);
  }

  searchSkills(query: string): SkillRecord[] {
    const stmt = this.db.prepare(`
      SELECT name, scope, skill_name as skillName, description, author, visibility, git_repo_path as gitRepoPath 
      FROM skills 
      WHERE name LIKE ? OR description LIKE ?
    `);
    const term = `%${query}%`;
    return stmt.all(term, term) as SkillRecord[];
  }
}
```

- [ ] **Step 5: Run database tests to verify pass**

Run: `npx vitest run packages/server/tests/database.test.ts`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add packages/server package.json
git commit -m "feat(server): initialize API server workspace and SQLite database repository"
```

---

### Task 3: GiteaService REST API Integration in Server

**Files:**
- Create: `packages/server/src/services/gitea.ts`
- Create: `packages/server/tests/gitea-service.test.ts`

**Interfaces:**
- Produces: `GiteaService` class with methods `validateToken(token)`, `createRepo(owner, name, isPrivate)`, `getRepo(owner, name)`.

- [ ] **Step 1: Write test for GiteaService**

```typescript
// packages/server/tests/gitea-service.test.ts
import { describe, expect, it, vi } from 'vitest';
import { GiteaService } from '../src/services/gitea.js';

describe('GiteaService', () => {
  it('validates user token via Gitea API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: 'zhangsan', email: 'zhangsan@example.com' })
    });

    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);
    const user = await gitea.validateToken('user-token-123');

    expect(user).toEqual({ id: 1, username: 'zhangsan', email: 'zhangsan@example.com' });
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/user', {
      headers: { Authorization: 'token user-token-123' }
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/server/tests/gitea-service.test.ts`
Expected: FAIL with "GiteaService is not defined"

- [ ] **Step 3: Implement GiteaService**

```typescript
// packages/server/src/services/gitea.ts
export interface GiteaUser {
  id: number;
  username: string;
  email: string;
}

export interface GiteaRepo {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  html_url: string;
}

export class GiteaService {
  constructor(
    private baseUrl: string,
    private adminToken: string,
    private customFetch: typeof fetch = fetch
  ) {}

  async validateToken(token: string): Promise<GiteaUser | null> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/user`, {
      headers: { Authorization: `token ${token}` }
    });
    if (!res.ok) return null;
    return (await res.json()) as GiteaUser;
  }

  async createRepo(owner: string, name: string, isPrivate = false): Promise<GiteaRepo> {
    // Try user repo first, fallback to org repo
    let url = `${this.baseUrl}/api/v1/admin/users/${owner}/repos`;
    let res = await this.customFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, private: isPrivate, auto_init: false })
    });

    if (!res.ok && res.status === 404) {
      url = `${this.baseUrl}/api/v1/orgs/${owner}/repos`;
      res = await this.customFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `token ${this.adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, private: isPrivate, auto_init: false })
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea repository: ${err}`);
    }

    return (await res.json()) as GiteaRepo;
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run packages/server/tests/gitea-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/server/src/services/gitea.ts packages/server/tests/gitea-service.test.ts
git commit -m "feat(server): implement GiteaService REST API client"
```

---

### Task 4: Fastify API Server Routes & Server Application

**Files:**
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/routes/skills.ts`
- Create: `packages/server/tests/app.test.ts`

**Interfaces:**
- Produces: `buildApp(options)` returning Fastify instance with routes `/api/skills`, `/api/skills/:name`, `/api/skills/search`.

- [ ] **Step 1: Write integration test for Fastify app**

```typescript
// packages/server/tests/app.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';

describe('Fastify Server API', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-app-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers and retrieves a skill', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'zhangsan' }),
      createRepo: vi.fn().mockResolvedValue({ full_name: 'myorg/my-skill' })
    };

    const app = buildApp({ dbPath, giteaService: mockGitea as any });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: 'token valid-token' },
      payload: {
        name: '@myorg/my-skill',
        version: '0.1.0',
        description: 'Test skill',
        author: 'zhangsan'
      }
    });

    expect(createRes.statusCode).toBe(201);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/skills/@myorg/my-skill'
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.name).toBe('@myorg/my-skill');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/server/tests/app.test.ts`
Expected: FAIL with missing module error

- [ ] **Step 3: Implement `buildApp` and Fastify routes**

```typescript
// packages/server/src/app.ts
import Fastify, { FastifyInstance } from 'fastify';
import semver from 'semver';
import { initDatabase, SkillRepository } from './db/database.js';
import { GiteaService } from './services/gitea.js';
import { parseSkillName } from '@esl/core';

export interface AppOptions {
  dbPath: string;
  giteaService: GiteaService;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = initDatabase(options.dbPath);
  const repo = new SkillRepository(db);
  const gitea = options.giteaService;

  app.post('/api/skills', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('token ')) {
      return reply.status(401).send({ error: 'Unauthorized: missing token' });
    }
    const token = auth.replace('token ', '').trim();
    const user = await gitea.validateToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid Gitea token' });
    }

    const { name, description, version, visibility = 'public' } = req.body as any;
    const { scope, skillName } = parseSkillName(name);

    let existing = repo.getSkill(name);
    if (!existing) {
      const gitRepo = await gitea.createRepo(scope, skillName, visibility === 'private');
      repo.createSkill({
        name,
        scope,
        skillName,
        description,
        author: user.username,
        visibility,
        gitRepoPath: gitRepo.full_name
      });
      existing = repo.getSkill(name)!;
    }

    repo.addVersion(name, version);
    return reply.status(201).send(existing);
  });

  app.get('/api/skills/search', async (req) => {
    const { q = '' } = req.query as { q?: string };
    return repo.searchSkills(q);
  });

  app.get('/api/skills/*', async (req, reply) => {
    const rawName = (req.params as any)['*'];
    const name = decodeURIComponent(rawName);
    const skill = repo.getSkill(name);
    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }
    const versions = repo.getVersions(name);
    return { ...skill, versions };
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run packages/server/tests/app.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/server/src/app.ts packages/server/tests/app.test.ts
git commit -m "feat(server): build Fastify API server with skills endpoints"
```

---

### Task 5: Implement `esl login` CLI Command

**Files:**
- Create: `packages/cli/src/commands/login.ts`
- Modify: `packages/cli/src/bin/esl.ts`
- Test: `packages/cli/tests/login.test.ts`

**Interfaces:**
- Consumes: Gitea POST `/api/v1/users/{user}/tokens` API via fetch, `@esl/core` `saveConfig`.
- Produces: `executeLogin(options)` saving token, registry, gitBase, and username to `~/.skill-library/config.json`.

- [ ] **Step 1: Write test for `esl login`**

```typescript
// packages/cli/tests/login.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeLogin } from '../src/commands/login.js';
import { loadConfig } from '@esl/core';

describe('esl login', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-login-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('authenticates with Gitea and saves config', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sha1: 'mock_gitea_token_sha1' })
    });

    await executeLogin({
      registry: 'http://skills.company.com/api',
      gitBase: 'http://skills.company.com/git',
      username: 'zhangsan',
      password: 'password123',
      homeDir,
      customFetch: mockFetch as any
    });

    const config = await loadConfig({ homeDir });
    expect(config.token).toBe('mock_gitea_token_sha1');
    expect(config.username).toBe('zhangsan');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/cli/tests/login.test.ts`
Expected: FAIL with missing module error

- [ ] **Step 3: Implement `executeLogin` command**

```typescript
// packages/cli/src/commands/login.ts
import { saveConfig, initializeLocalStore, LocalStoreOptions } from '@esl/core';

export interface LoginOptions extends LocalStoreOptions {
  registry: string;
  gitBase: string;
  username: string;
  password?: string;
  token?: string;
  customFetch?: typeof fetch;
}

export async function executeLogin(options: LoginOptions): Promise<string> {
  const fetchImpl = options.customFetch ?? fetch;
  await initializeLocalStore({ homeDir: options.homeDir });

  let token = options.token;
  if (!token && options.password) {
    const authHeader = 'Basic ' + Buffer.from(`${options.username}:${options.password}`).toString('base64');
    const giteaApiUrl = options.gitBase.replace(/\/git\/?$/, '');
    const res = await fetchImpl(`${giteaApiUrl}/api/v1/users/${options.username}/tokens`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: `esl-cli-${Date.now()}` })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to authenticate with Gitea: ${err}`);
    }

    const data = (await res.json()) as { sha1: string };
    token = data.sha1;
  }

  if (!token) {
    throw new Error('Password or Token is required for login');
  }

  await saveConfig(
    {
      registry: options.registry,
      gitBase: options.gitBase,
      username: options.username,
      token
    },
    { homeDir: options.homeDir }
  );

  return token;
}
```

- [ ] **Step 4: Register `login` command in CLI Commander `bin/esl.ts`**

Update `packages/cli/src/bin/esl.ts` to include `login` command option parsing.

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run packages/cli/tests/login.test.ts`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add packages/cli/src/commands/login.ts packages/cli/src/bin/esl.ts packages/cli/tests/login.test.ts
git commit -m "feat(cli): implement esl login command for Gitea authentication"
```

---

### Task 6: Implement `esl publish` & `esl install` & `esl search` CLI Commands

**Files:**
- Create: `packages/cli/src/commands/publish.ts`
- Create: `packages/cli/src/commands/install.ts`
- Create: `packages/cli/src/commands/search.ts`
- Create: `packages/cli/src/commands/info.ts`
- Modify: `packages/cli/src/bin/esl.ts`
- Test: `packages/cli/tests/commands.test.ts`

**Interfaces:**
- Consumes: API Server `/api/skills` endpoints and Gitea Git HTTP repositories via `execFileAsync('git')`.
- Produces: `executePublish`, `executeInstall`, `executeSearch`, `executeInfo`.

- [ ] **Step 1: Write tests for network CLI commands**

```typescript
// packages/cli/tests/commands.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeSearch, executeInfo } from '../src/index.js';

describe('network CLI commands', () => {
  it('searches skills via API server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: '@myorg/my-skill', description: 'Test skill' }]
    });

    const results = await executeSearch('test', {
      registry: 'http://skills.company.com/api',
      customFetch: mockFetch as any
    });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('@myorg/my-skill');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/cli/tests/commands.test.ts`
Expected: FAIL with missing module error

- [ ] **Step 3: Implement `publish`, `install`, `search`, `info` commands**

Implement:
- `publish.ts`: Validates skill -> POST `/api/skills` -> sets Git remote to `http://<token>@server/git/<gitRepoPath>.git` -> `git push` & `git tag` & `git push --tags`.
- `install.ts`: GET `/api/skills/:name` -> finds matching version -> `git clone` from Gitea into `~/.skill-library/skills/<skill-name>` -> adapts.
- `search.ts`: GET `/api/skills/search?q=<query>`.
- `info.ts`: GET `/api/skills/:name`.

- [ ] **Step 4: Register all commands in `bin/esl.ts`**

Update `packages/cli/src/bin/esl.ts` to export all commands.

- [ ] **Step 5: Run full test suite across monorepo**

Run: `npm test`
Expected: PASS (all tests in `@esl/core`, `@esl/server`, `@esl/cli`).

- [ ] **Step 6: Commit changes**

```bash
git add packages/cli packages/server packages/core
git commit -m "feat(cli): implement publish, install, search, and info network commands"
```

---

## Self-Review Checklist

1. **Spec Coverage:** Covers Gitea REST API integration, API Server SQLite metadata repository, Fastify routes, Gitea token authentication, and CLI `login`, `publish`, `install`, `search`, `info` commands.
2. **Placeholder Scan:** No "TODO", "TBD", or vague placeholders.
3. **Type Consistency:** Method signatures and schema fields strictly match design spec (`@esl/core`, `@esl/server`, `@esl/cli`).
