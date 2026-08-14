# Admin Password Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the platform administrator log in with their Gitea password (instead of only the bootstrap token) and make CLI login expire client-side after 30 days.

**Architecture:** The server gains a Gitea fallback in its administrator authorization path: when a presented token does not match the bootstrap token, the server asks Gitea whose token it is and treats it as administrator when it belongs to `GITEA_ADMIN_USERNAME`. The CLI records a `loginAt` timestamp in credentials and a shared `requireFreshToken` helper rejects stale credentials before any token-consuming command.

**Tech Stack:** TypeScript, Fastify (server), Commander (CLI), better-sqlite3, vitest.

## Global Constraints

- No new dependencies.
- Follow existing file conventions in each package (`packages/core`, `packages/cli`, `packages/server`).
- Tests use vitest; run with `npm test` from the repo root.
- Build check: `npm run build`.
- Commit messages follow the repo's existing lowercase `type: summary` style.

---

### Task 1: Recognize Gitea administrator tokens in GiteaService

**Files:**
- Modify: `packages/server/src/services/gitea.ts`
- Test: `packages/server/tests/gitea-service.test.ts`

**Interfaces:**
- Consumes: `GiteaService` fields `adminUsername?: string` and existing `validateToken(token: string): Promise<GiteaUser | null>` and `changeUserPassword(username: string, password: string): Promise<void>`.
- Produces: `validateAdminUserToken(token: string): Promise<GiteaUser | null>` and `changeAdminPassword(password: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/tests/gitea-service.test.ts` (inside the existing `describe('GiteaService', ...)` block):

```ts
  it('recognizes the administrator token via Gitea validation', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: 'eslroot', email: 'eslroot@local.esl' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any, 'eslroot');

    await expect(gitea.validateAdminUserToken('some-token')).resolves.toEqual({
      id: 1,
      username: 'eslroot',
      email: 'eslroot@local.esl'
    });
  });

  it('returns null when the token does not belong to the administrator', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 2, username: 'alice', email: 'alice@local.esl' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any, 'eslroot');

    await expect(gitea.validateAdminUserToken('alice-token')).resolves.toBeNull();
  });

  it('returns null when no administrator username is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: 'eslroot', email: 'eslroot@local.esl' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.validateAdminUserToken('some-token')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('changes the administrator password via the configured admin username', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any, 'eslroot');

    await gitea.changeAdminPassword('new-password');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/users/eslroot', {
      method: 'PATCH',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: 'new-password' })
    });
  });

  it('throws when changing the administrator password without a configured username', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.changeAdminPassword('new-password')).rejects.toThrow(/admin username required/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run packages/server/tests/gitea-service.test.ts`
Expected: FAIL — `gitea.validateAdminUserToken is not a function` and `gitea.changeAdminPassword is not a function`.

- [ ] **Step 3: Implement the two methods**

In `packages/server/src/services/gitea.ts`, add after the existing `validateAdminToken` method (after line 37):

```ts
  async validateAdminUserToken(token: string): Promise<GiteaUser | null> {
    if (!this.adminUsername) {
      return null;
    }
    const user = await this.validateToken(token);
    return user && user.username === this.adminUsername ? user : null;
  }
```

And add after the existing `changeUserPassword` method (after line 135):

```ts
  async changeAdminPassword(password: string): Promise<void> {
    if (!this.adminUsername) {
      throw new Error('Gitea admin username required to change the administrator password');
    }
    await this.changeUserPassword(this.adminUsername, password);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run packages/server/tests/gitea-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/gitea.ts packages/server/tests/gitea-service.test.ts
git commit -m "feat: recognize Gitea administrator tokens in GiteaService"
```

---

### Task 2: Authorize administrator tokens via the Gitea fallback

**Files:**
- Modify: `packages/server/src/routes/admin.ts`
- Test: `packages/server/tests/admin.test.ts`

**Interfaces:**
- Consumes: `GiteaService.validateAdminUserToken(token)` and `GiteaService.changeAdminPassword(password)` from Task 1; existing `AdminRepository.getPlatformAdminForToken(token)`.
- Produces: `authorize(request, reply, repository, giteaService)` (async), which later admin routes keep calling.

- [ ] **Step 1: Write the failing tests**

In `packages/server/tests/admin.test.ts`, add two tests inside `describe('Admin API', ...)`:

```ts
  it('authorizes a password-minted administrator token via the Gitea fallback', async () => {
    const mockGitea = {
      validateAdminUserToken: async () => ({ username: 'eslroot' }),
      createUser: async () => undefined
    };
    app = buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token password-minted-token' },
      payload: { username: 'alice' }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ username: 'alice', disabled: false });
  });

  it('rejects a non-administrator token on admin routes', async () => {
    const mockGitea = {
      validateAdminUserToken: async () => null,
      createUser: async () => undefined
    };
    app = buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token some-user-token' },
      payload: { username: 'alice' }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Forbidden: platform administrator token required' });
  });
```

Also update the existing `changes the Gitea administrator password` test: replace its mock and assertion. Change the mock object from `{ changeUserPassword }` to `{ changeAdminPassword }` and the assertion from `expect(changeUserPassword).toHaveBeenCalledWith('admin', 'new-password')` to `expect(changeAdminPassword).toHaveBeenCalledWith('new-password')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run packages/server/tests/admin.test.ts`
Expected: FAIL — the password-minted token test returns 403; the password-change test fails because `changeAdminPassword` is not called.

- [ ] **Step 3: Implement the async Gitea fallback**

In `packages/server/src/routes/admin.ts`, update the four route handlers to await the fallback. For the `users`, `tokens`, and `disable` routes, change:

```ts
    if (!authorize(request, reply, repository)) return;
```

to:

```ts
    if (!(await authorize(request, reply, repository, giteaService))) return;
```

For the `gitea/password` route, change:

```ts
  app.post('/api/admin/gitea/password', async (request, reply) => {
    const admin = authorize(request, reply, repository);
    if (!admin) return;
    const { password } = request.body as { password: string };
    await giteaService.changeUserPassword('admin', password);
    return { passwordChanged: true };
  });
```

to:

```ts
  app.post('/api/admin/gitea/password', async (request, reply) => {
    const admin = await authorize(request, reply, repository, giteaService);
    if (!admin) return;
    const { password } = request.body as { password: string };
    await giteaService.changeAdminPassword(password);
    return { passwordChanged: true };
  });
```

Replace the `authorize` function with:

```ts
async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: AdminRepository,
  giteaService: GiteaService
): Promise<{ username: string } | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send({ error: 'Unauthorized: missing token' });
    return null;
  }

  const token = authorization.replace('token ', '').trim();
  const admin = repository.getPlatformAdminForToken(token);
  if (admin) return admin;

  const giteaAdmin = await giteaService.validateAdminUserToken(token);
  if (giteaAdmin) return { username: giteaAdmin.username };

  reply.status(403).send({ error: 'Forbidden: platform administrator token required' });
  return null;
}
```

`GiteaService` is already imported as a type at the top of `admin.ts`; no import change is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run packages/server/tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/admin.ts packages/server/tests/admin.test.ts
git commit -m "feat: authorize administrator tokens via Gitea fallback"
```

---

### Task 3: Add loginAt to the credentials store

**Files:**
- Modify: `packages/core/src/store/local-store.ts`
- Test: `packages/core/tests/local-store.test.ts`

**Interfaces:**
- Consumes: existing `EslCredentials`, `initializeLocalStore`, `saveCredentials`, `loadCredentials`.
- Produces: `EslCredentials` now has `loginAt: string | null`, and `initializeLocalStore` defaults `credentials.json` to `{ token: null, loginAt: null }`.

- [ ] **Step 1: Write the failing tests**

In `packages/core/tests/local-store.test.ts`, update two existing assertions. Change the `initializes directories and default JSON files` test's credentials assertion from:

```ts
    expect(JSON.parse(fs.readFileSync(paths.credentialsJson, 'utf8'))).toEqual({
      token: null
    });
```

to:

```ts
    expect(JSON.parse(fs.readFileSync(paths.credentialsJson, 'utf8'))).toEqual({
      token: null,
      loginAt: null
    });
```

Change the `saves and loads credentials separately from config` test's assertion from:

```ts
    expect(credentials).toEqual({ token: 'secret_token_123' });
```

to:

```ts
    expect(credentials).toEqual({ token: 'secret_token_123', loginAt: null });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run packages/core/tests/local-store.test.ts`
Expected: FAIL — default credentials and merged credentials now include `loginAt: null`.

- [ ] **Step 3: Implement the field**

In `packages/core/src/store/local-store.ts`, change the `EslCredentials` interface:

```ts
export interface EslCredentials {
  token: string | null;
  loginAt: string | null;
}
```

And change the `initializeLocalStore` default:

```ts
  await writeJsonIfMissing(paths.credentialsJson, {
    token: null,
    loginAt: null
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run packages/core/tests/local-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/local-store.ts packages/core/tests/local-store.test.ts
git commit -m "feat: record login time in credentials store"
```

---

### Task 4: Record login time on login

**Files:**
- Modify: `packages/cli/src/commands/login.ts`
- Test: `packages/cli/tests/login.test.ts`

**Interfaces:**
- Consumes: `EslCredentials.loginAt` from Task 3.
- Produces: `executeLogin` persists a `loginAt` timestamp alongside the token.

- [ ] **Step 1: Write the failing test**

In `packages/cli/tests/login.test.ts`, add:

```ts
  it('records the login time when storing credentials', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sha1: 'mock_gitea_token_sha1' })
    });
    const passwordFile = path.join(homeDir, 'pw.txt');
    fs.writeFileSync(passwordFile, 'password123');

    await executeLogin({
      registry: 'http://skills.company.com/api',
      gitBase: 'http://skills.company.com/git',
      username: 'zhangsan',
      passwordFile,
      homeDir,
      customFetch: mockFetch as any
    });

    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBe('mock_gitea_token_sha1');
    expect(credentials.loginAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(credentials.loginAt as string))).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run packages/cli/tests/login.test.ts`
Expected: FAIL — `credentials.loginAt` is `undefined`.

- [ ] **Step 3: Implement the timestamp**

In `packages/cli/src/commands/login.ts`, change:

```ts
  await saveCredentials({ token }, { homeDir: options.homeDir });
```

to:

```ts
  await saveCredentials({ token, loginAt: new Date().toISOString() }, { homeDir: options.homeDir });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run packages/cli/tests/login.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/login.ts packages/cli/tests/login.test.ts
git commit -m "feat: record login time on login"
```

---

### Task 5: Add requireFreshToken and the TTL resolver

**Files:**
- Modify: `packages/cli/src/commands/network-options.ts`
- Test: `packages/cli/tests/network-options.test.ts`

**Interfaces:**
- Consumes: `EslCredentials.loginAt` from Task 3; existing `requireConfigured` and `loadCredentials` in the same file.
- Produces: `resolveLoginTtlMs(): number` and `requireFreshToken(options: LocalStoreOptions): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

In `packages/cli/tests/network-options.test.ts`, add imports at the top:

```ts
import fs from 'node:fs';
import os from 'node:os';
import { initializeLocalStore, saveCredentials } from '@esl/core';
```

And update the import from `../src/commands/network-options.js` to also import `requireFreshToken` and `resolveLoginTtlMs`. Then add:

```ts
describe('resolveLoginTtlMs', () => {
  it('defaults to 30 days in milliseconds', () => {
    expect(resolveLoginTtlMs()).toBe(720 * 3_600_000);
  });

  it('reads ESL_LOGIN_TTL_HOURS from the environment', () => {
    vi.stubEnv('ESL_LOGIN_TTL_HOURS', '24');
    expect(resolveLoginTtlMs()).toBe(24 * 3_600_000);
    vi.unstubAllEnvs();
  });
});

describe('requireFreshToken', () => {
  it('returns the token when the login is fresh', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-fresh-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'tok', loginAt: new Date().toISOString() }, { homeDir });

    await expect(requireFreshToken({ homeDir })).resolves.toBe('tok');

    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('throws when the login is expired', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-expired-'));
    await initializeLocalStore({ homeDir });
    const past = new Date(Date.now() - 31 * 24 * 3_600_000).toISOString();
    await saveCredentials({ token: 'tok', loginAt: past }, { homeDir });

    await expect(requireFreshToken({ homeDir })).rejects.toThrow('Login expired; run esl login to re-authenticate');

    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('throws when loginAt is missing', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-missing-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'tok' }, { homeDir });

    await expect(requireFreshToken({ homeDir })).rejects.toThrow('Login expired; run esl login to re-authenticate');

    fs.rmSync(homeDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run packages/cli/tests/network-options.test.ts`
Expected: FAIL — `resolveLoginTtlMs` and `requireFreshToken` are not exported.

- [ ] **Step 3: Implement the helpers**

In `packages/cli/src/commands/network-options.ts`, add after `resolveTimeoutMs`:

```ts
export function resolveLoginTtlMs(): number {
  const env = process.env.ESL_LOGIN_TTL_HOURS;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 3_600_000;
    }
  }
  return 720 * 3_600_000;
}

export async function requireFreshToken(options: LocalStoreOptions = {}): Promise<string> {
  const credentials = await loadCredentials({ homeDir: options.homeDir });
  const token = requireConfigured(credentials.token, 'token');
  if (!credentials.loginAt) {
    throw new Error('Login expired; run esl login to re-authenticate');
  }
  const loginAt = Date.parse(credentials.loginAt);
  if (Number.isNaN(loginAt) || Date.now() - loginAt > resolveLoginTtlMs()) {
    throw new Error('Login expired; run esl login to re-authenticate');
  }
  return token;
}
```

`LocalStoreOptions` and `loadCredentials` are already imported in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run packages/cli/tests/network-options.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/network-options.ts packages/cli/tests/network-options.test.ts
git commit -m "feat: enforce client-side login expiry"
```

---

### Task 6: Enforce login freshness on admin commands

**Files:**
- Modify: `packages/cli/src/commands/admin.ts`
- Test: `packages/cli/tests/admin.test.ts`

**Interfaces:**
- Consumes: `requireFreshToken` from Task 5.
- Produces: `resolveAdminAuth` now enforces freshness; behavior of `executeCreateUser`, `executeIssueUserToken`, `executeDisableUser`, `executeGiteaPasswordChange` unchanged.

- [ ] **Step 1: Write the failing tests**

In `packages/cli/tests/admin.test.ts`, update `seedAdmin` so credentials include a fresh `loginAt`. Change:

```ts
    await saveCredentials({ token: adminToken }, { homeDir });
```

to:

```ts
    await saveCredentials({ token: adminToken, loginAt: new Date().toISOString() }, { homeDir });
```

Add a new test:

```ts
  it('rejects an admin command when the login is expired', async () => {
    const mockFetch = vi.fn();
    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        registry: 'http://skills.company.com/api',
        gitBase: 'http://skills.company.com/git',
        username: 'admin',
        tools: []
      },
      { homeDir }
    );
    await saveCredentials(
      { token: 'bootstrap-token', loginAt: new Date(Date.now() - 31 * 24 * 3_600_000).toISOString() },
      { homeDir }
    );

    await expect(executeCreateUser('alice', { homeDir, customFetch: mockFetch as any })).rejects.toThrow(
      'Login expired; run esl login to re-authenticate'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run packages/cli/tests/admin.test.ts`
Expected: FAIL — the expired-login test fails because freshness is not yet checked.

- [ ] **Step 3: Implement the freshness check**

In `packages/cli/src/commands/admin.ts`, update the import from `./network-options.js` to include `requireFreshToken`:

```ts
import { apiUrl, fetchWithTimeout, requireConfigured, requireFreshToken, type NetworkCommandOptions } from './network-options.js';
```

Remove `loadCredentials` from the `@esl/core` import (it is no longer used). Then replace `resolveAdminAuth` with:

```ts
async function resolveAdminAuth(
  options: NetworkCommandOptions & LocalStoreOptions
): Promise<{ registry: string; token: string; username: string }> {
  const config = await loadConfig({ homeDir: options.homeDir });
  return {
    registry: options.registry ?? requireConfigured(config.registry, 'registry'),
    token: await requireFreshToken(options),
    username: requireConfigured(config.username, 'username')
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run packages/cli/tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/admin.ts packages/cli/tests/admin.test.ts
git commit -m "feat: enforce login freshness on admin commands"
```

---

### Task 7: Enforce login freshness on git commands

**Files:**
- Modify: `packages/cli/src/commands/install.ts`
- Modify: `packages/cli/src/commands/publish.ts`
- Modify: `packages/cli/src/commands/source.ts`
- Modify: `packages/cli/src/commands/use.ts`
- Test: `packages/cli/tests/install.test.ts`
- Test: `packages/cli/tests/install-project.test.ts`
- Test: `packages/cli/tests/publish.test.ts`
- Test: `packages/cli/tests/source.test.ts`
- Test: `packages/cli/tests/update.test.ts`

**Interfaces:**
- Consumes: `requireFreshToken` from Task 5.
- Produces: `executeInstall`, `executePublish`, `executeSource`, `executeUse` now resolve the token via `requireFreshToken` (and therefore reject expired logins).

- [ ] **Step 1: Write the failing tests**

Update the credential seeding in the five test files to include a fresh `loginAt`, and add one expiry test. In each file, change the line:

```ts
await saveCredentials({ token: 'gitea-token' }, { homeDir });
```

to:

```ts
await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
```

The seeding calls live at:
- `packages/cli/tests/install.test.ts` (in `beforeEach`)
- `packages/cli/tests/install-project.test.ts` (in `beforeEach`)
- `packages/cli/tests/publish.test.ts` (in `beforeEach`)
- `packages/cli/tests/source.test.ts` (in `beforeEach`)
- `packages/cli/tests/update.test.ts` (inside the `updates registry-backed skills from the global manifest` test)

Add this test to `packages/cli/tests/publish.test.ts`:

```ts
  it('fails fast when the login has expired', async () => {
    await saveCredentials(
      { token: 'gitea-token', loginAt: new Date(Date.now() - 31 * 24 * 3_600_000).toISOString() },
      { homeDir }
    );
    const fetchImpl = vi.fn();

    await expect(
      executePublish({
        directory: skillDir,
        registry: 'http://localhost:3000/api',
        gitBase: 'http://localhost:3001',
        homeDir,
        force: true,
        customFetch: fetchImpl as any,
        execFileAsync: vi.fn() as any
      })
    ).rejects.toThrow('Login expired; run esl login to re-authenticate');

    expect(fetchImpl).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run packages/cli/tests/publish.test.ts packages/cli/tests/install.test.ts`
Expected: FAIL — the expiry test throws because freshness is not yet checked.

- [ ] **Step 3: Implement the freshness checks**

In each of the four command files, add `requireFreshToken` to the import from `./network-options.js`, then replace the token resolution.

`packages/cli/src/commands/install.ts` — change:

```ts
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
```

to:

```ts
  const { gitBase } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = await requireFreshToken(options);
```

`packages/cli/src/commands/publish.ts` — change:

```ts
  const { registry, gitBase, token } = await resolveNetworkConfig(options);
  const authToken = requireConfigured(token, 'token');
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
```

to:

```ts
  const { registry, gitBase } = await resolveNetworkConfig(options);
  const authToken = await requireFreshToken(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
```

`packages/cli/src/commands/source.ts` — change:

```ts
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
```

to:

```ts
  const { gitBase } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = await requireFreshToken(options);
```

`packages/cli/src/commands/use.ts` — change:

```ts
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
```

to:

```ts
  const { gitBase } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = await requireFreshToken(options);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run packages/cli/tests/publish.test.ts packages/cli/tests/install.test.ts packages/cli/tests/install-project.test.ts packages/cli/tests/source.test.ts packages/cli/tests/use.test.ts packages/cli/tests/update.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/install.ts packages/cli/src/commands/publish.ts packages/cli/src/commands/source.ts packages/cli/src/commands/use.ts packages/cli/tests/install.test.ts packages/cli/tests/install-project.test.ts packages/cli/tests/publish.test.ts packages/cli/tests/source.test.ts packages/cli/tests/update.test.ts
git commit -m "feat: enforce login freshness on git commands"
```

---

### Task 8: Document administrator password login and expiry

**Files:**
- Modify: `USAGE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: updated user-facing login documentation.

- [ ] **Step 1: Add the documentation**

In `USAGE.md`, in the `### 2. 登录认证 (Login)` section, directly after the platform administrator bootstrap-token example (the code block ending at line 51), add:

````markdown
平台管理员也可以用 Gitea 账号密码登录（交互式输入密码，与普通用户一致）：

```powershell
esl login \
  --registry http://localhost:3000/api \
  --git-base http://localhost:3001 \
  --username eslroot
```

登录后的 token 默认 30 天有效，过期后需重新登录；可通过环境变量 `ESL_LOGIN_TTL_HOURS` 调整有效期（单位：小时）。
````

- [ ] **Step 2: Verify the docs render**

Read the section back to confirm the code fence and text are well-formed.

- [ ] **Step 3: Commit**

```bash
git add USAGE.md
git commit -m "docs: document administrator password login and login expiry"
```

---

### Final Verification

- [ ] Run the full test suite: `npm test`
- [ ] Run the build: `npm run build`

Both must pass before the work is considered complete.

---

## Self-Review

- **Spec coverage:** Server fallback (Tasks 1-2), password-change bug fix (Tasks 1-2), `loginAt` storage (Task 3), login timestamp (Task 4), `requireFreshToken` + TTL (Task 5), admin enforcement (Task 6), git-command enforcement (Task 7), configuration/documentation (Task 8). No spec section is left unaddressed.
- **Placeholder scan:** No TBD/TODO; every step has concrete code.
- **Type consistency:** `validateAdminUserToken(token): Promise<GiteaUser | null>`, `changeAdminPassword(password): Promise<void>`, `requireFreshToken(options): Promise<string>`, and `resolveLoginTtlMs(): number` are used consistently across tasks.
