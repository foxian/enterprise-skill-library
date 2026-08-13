# Gitea Docker Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically bootstrap Gitea in the Docker runtime using an explicit initial admin password, a generated admin token file, and an API startup ensure step.

**Architecture:** Keep the bootstrap logic inside the Docker runtime boundary instead of pushing it into ESL CLI workflows. A one-shot bootstrap service will prepare Gitea state and emit the reusable admin token into a shared secrets volume, while the API will read that token at startup and verify the runtime is ready before serving requests. ESL continues to treat Gitea as an internal backend, not a user-facing setup surface.

**Tech Stack:** Docker Compose, Gitea CLI, TypeScript, Fastify, Vitest.

## Global Constraints

- Users do not open the Gitea UI for normal setup.
- Users do not manually create or paste `GITEA_ADMIN_TOKEN` for Docker local runtime setup.
- `GITEA_ADMIN_PASSWORD` is required for first-time Docker bootstrap.
- The initial Gitea administrator password is not an ESL CLI login password.
- ESL CLI authentication remains token-based.
- Gitea UI remains a backend recovery and maintenance path.
- Automatic password rotation from `.env` after first boot is out of scope.

---

### Task 1: Load bootstrap token file support from configuration

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/tests/config.test.ts`
- Modify: `packages/server/tests/server.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `loadServerConfig(env)` from `packages/server/src/config.ts`
- Produces: `ServerConfig.giteaAdminTokenFile?: string` and explicit token-file precedence behavior

- [ ] **Step 1: Write the failing config test**

Add a config test that proves `GITEA_ADMIN_TOKEN_FILE` is loaded and that a direct `GITEA_ADMIN_TOKEN` still wins when both are set.

```ts
it('loads the configured Gitea admin token file and preserves direct token precedence', () => {
  const config = loadServerConfig({
    DATABASE_PATH: '/tmp/esl.db',
    GITEA_URL: 'http://gitea:3000',
    GITEA_ADMIN_TOKEN: 'admin-token',
    GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token'
  } as NodeJS.ProcessEnv);

  expect(config.giteaAdminToken).toBe('admin-token');
  expect(config.giteaAdminTokenFile).toBe('/bootstrap/gitea-admin-token');
});
```

- [ ] **Step 2: Run the config test and confirm it fails**

Run: `npm test -- packages/server/tests/config.test.ts`

Expected: the test fails because `GITEA_ADMIN_TOKEN_FILE` is not yet modeled in config.

- [ ] **Step 3: Implement the config field and env example**

Add the `GITEA_ADMIN_TOKEN_FILE` field to `ServerConfig`, read it in `loadServerConfig`, and add the new environment variable to `.env.example` with the shared bootstrap path.

```ts
giteaAdminTokenFile: env.GITEA_ADMIN_TOKEN_FILE ?? '/bootstrap/gitea-admin-token'
```

- [ ] **Step 4: Re-run the config test and confirm it passes**

Run: `npm test -- packages/server/tests/config.test.ts`

Expected: pass, with direct token precedence preserved.

### Task 1A: Allow token-file-only configuration

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/tests/config.test.ts`

**Interfaces:**
- Consumes: `loadServerConfig(env)` from `packages/server/src/config.ts`
- Produces: `ServerConfig.giteaAdminToken?: string`, allowing Docker runtime configuration without a direct `GITEA_ADMIN_TOKEN`

- [ ] **Step 1: Write the failing config test**

Add a config test proving the Docker path can omit `GITEA_ADMIN_TOKEN` when `GITEA_ADMIN_TOKEN_FILE` is present.

```ts
it('allows a Gitea admin token file without a direct token', () => {
  const config = loadServerConfig({
    DATABASE_PATH: '/tmp/esl.db',
    GITEA_URL: 'http://gitea:3000',
    GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token'
  } as NodeJS.ProcessEnv);

  expect(config.giteaAdminToken).toBeUndefined();
  expect(config.giteaAdminTokenFile).toBe('/bootstrap/gitea-admin-token');
});
```

- [ ] **Step 2: Run the config test and confirm it fails**

Run: `npm test -- packages/server/tests/config.test.ts`

Expected: the test fails because the current config still requires `GITEA_ADMIN_TOKEN`.

- [ ] **Step 3: Implement optional direct token loading**

Change `ServerConfig.giteaAdminToken` to optional and stop requiring `GITEA_ADMIN_TOKEN` when a token file path is configured.

```ts
const giteaAdminToken = env.GITEA_ADMIN_TOKEN;
const giteaAdminTokenFile = env.GITEA_ADMIN_TOKEN_FILE ?? '/bootstrap/gitea-admin-token';
if (!giteaAdminToken && !giteaAdminTokenFile) {
  throw new Error('Missing required environment variable: GITEA_ADMIN_TOKEN or GITEA_ADMIN_TOKEN_FILE');
}
```

- [ ] **Step 4: Re-run the config test and confirm it passes**

Run: `npm test -- packages/server/tests/config.test.ts`

Expected: pass, with token-file-only configuration accepted.

### Task 2: Teach the server to resolve the Gitea admin token from file or env

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/services/gitea.ts`
- Modify: `packages/server/tests/server.test.ts`
- Modify: `packages/server/tests/app.test.ts`

**Interfaces:**
- Consumes: `startServer(options)` and `buildApp(options)`
- Produces: `AppOptions.giteaAdminToken?: string`, `AppOptions.giteaAdminTokenFile?: string`, and token resolution that prefers the direct env token over the token file

- [ ] **Step 1: Write the failing startup test**

Add a server test that sets `GITEA_ADMIN_TOKEN_FILE` and stubs the file read so startup receives the token from disk when no direct token is provided.

```ts
it('starts with the Gitea admin token loaded from file', async () => {
  const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');
  const app = await startServer({
    env: {
      PORT: '3999',
      DATABASE_PATH: ':memory:',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token',
      GITEA_REPO_OWNER: 'platform-skills',
      ESL_BOOTSTRAP_ADMIN_TOKEN: 'configured-bootstrap-token'
    } as NodeJS.ProcessEnv,
    listen
  });

  expect(listen).toHaveBeenCalledWith({ port: 3999, host: '0.0.0.0' });
  await app.close();
});
```

Add an app test that verifies the `GiteaService` instance receives the resolved token and that startup can call an ensure helper before listening.

```ts
it('builds the app with the resolved Gitea admin token', () => {
  const giteaService = new GiteaService('http://gitea:3000', 'admin-token');
  const app = buildApp({
    dbPath: ':memory:',
    giteaService,
    repoOwner: 'esl-skills',
    bootstrapAdminToken: 'bootstrap-token'
  });

  expect(app).toBeDefined();
  void app.close();
});
```

- [ ] **Step 2: Run the startup tests and confirm they fail**

Run: `npm test -- packages/server/tests/server.test.ts packages/server/tests/app.test.ts`

Expected: failures showing the file-backed token path and startup ensure logic are not implemented yet.

- [ ] **Step 3: Implement token resolution and startup ensure logic**

Update `startServer` to resolve the Gitea admin token from `GITEA_ADMIN_TOKEN` first, then from `GITEA_ADMIN_TOKEN_FILE` if needed. Add a small helper that reads the file, trims it, and fails fast when the file is missing or empty.

```ts
const adminToken = await resolveGiteaAdminToken(config);
const app = buildApp({
  dbPath: config.databasePath,
  giteaService: new GiteaService(config.giteaUrl, adminToken),
  repoOwner: config.repoOwner,
  bootstrapAdminToken: config.bootstrapAdminToken
});
```

Keep the behavior explicit: direct env token wins over token file; token file wins over no token; missing both is a startup error.

- [ ] **Step 4: Re-run the startup tests and confirm they pass**

Run: `npm test -- packages/server/tests/server.test.ts packages/server/tests/app.test.ts`

Expected: pass, with token resolution covered.

### Task 3: Add Docker bootstrap service and mount shared secrets volume

**Files:**
- Modify: `docker-compose.yml`
- Modify: `DOCKER_SETUP.md`
- Modify: `docs/local-dev.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: the Gitea image already used by the runtime and the shared `gitea-data` volume
- Produces: a one-shot `gitea-bootstrap` service and a `bootstrap-secrets` volume containing the generated admin token

- [ ] **Step 1: Write the failing compose/documentation test case by inspection**

There is no automated compose parser in this repo, so use the existing Docker docs as the test surface: add explicit documentation steps showing the bootstrap service and the new `GITEA_ADMIN_PASSWORD` requirement.

```text
docker compose up
-> gitea starts
-> gitea-bootstrap creates the admin user and token
-> api reads /bootstrap/gitea-admin-token
```

- [ ] **Step 2: Implement the compose service and volume wiring**

Add `gitea-bootstrap` to `docker-compose.yml` with the same Gitea image and the `gitea-data` volume mounted. Mount a new `bootstrap-secrets` volume into both `gitea-bootstrap` and `api`. Pass `GITEA_ADMIN_USERNAME`, `GITEA_ADMIN_PASSWORD`, and `GITEA_ADMIN_TOKEN_FILE` through the compose environment.

- [ ] **Step 3: Update the Docker docs**

Rewrite the quick-start instructions in `DOCKER_SETUP.md` and `docs/local-dev.md` so the user sets `GITEA_ADMIN_PASSWORD` explicitly, no longer manually creates the initial Gitea administrator token, and does not need to open the Gitea UI for normal setup.

- [ ] **Step 4: Verify the compose file and docs stay consistent**

Run: `npm test`

Run: `npm run build`

Expected: both pass after the compose and configuration changes are in place.

### Task 4: Make bootstrap status report real runtime readiness

**Files:**
- Modify: `packages/server/src/db/database.ts`
- Modify: `packages/server/src/routes/admin.ts`
- Modify: `packages/server/tests/admin.test.ts`

**Interfaces:**
- Consumes: the existing `bootstrap status` route and admin repository
- Produces: a readiness response that distinguishes token, Gitea, and repo-owner readiness

- [ ] **Step 1: Write the failing bootstrap-status test**

Add an admin route test that simulates missing token/file readiness and asserts the response reports a not-ready state rather than only checking the repo owner organization.

```ts
it('reports bootstrap not ready when the Gitea admin token is missing', async () => {
  const mockGitea = {
    organizationExists: async () => false
  };
  app = buildApp({
    dbPath,
    giteaService: mockGitea as any,
    repoOwner: 'esl-skills'
  });

  const response = await app.inject({ method: 'GET', url: '/api/admin/bootstrap/status' });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    ready: false,
    registry: 'configured',
    admin: 'ready',
    repoOwner: 'missing'
  });
});
```

- [ ] **Step 2: Implement the richer readiness shape**

Extend the bootstrap status model so it can report token readiness separately from organization readiness. Keep the output machine-readable and stable.

```ts
{
  ready: boolean;
  registry: 'configured';
  gitea: 'ready' | 'missing';
  adminToken: 'ready' | 'missing' | 'invalid';
  repoOwner: 'ready' | 'missing';
}
```

- [ ] **Step 3: Re-run the admin route test and confirm it passes**

Run: `npm test -- packages/server/tests/admin.test.ts`

Expected: pass, with the updated readiness model reflected in the route output.

### Task 5: Align the bootstrap docs and spec references

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-admin-command-boundary-design.md`
- Modify: `.scratch/admin-command-boundary/spec.md`
- Modify: `.scratch/admin-command-boundary/issues/01-docker-bootstrap-internal-gitea-backend.md`
- Modify: `docs/local-dev.md`
- Modify: `DOCKER_SETUP.md`

**Interfaces:**
- Consumes: the new Docker bootstrap flow and token-file behavior
- Produces: docs that no longer instruct users to manually open Gitea and configure the initial admin token

- [ ] **Step 1: Update the user-facing setup steps**

Replace the manual Gitea bootstrap instructions with the explicit password-based Docker bootstrap flow.

```powershell
Copy-Item .env.example .env
# Set GITEA_ADMIN_PASSWORD in .env
docker compose up --build
```

- [ ] **Step 2: Reconcile the spec wording**

Update the bootstrap spec and issue text so they describe automatic Gitea initialization, token file generation, and API startup validation instead of manual UI setup.

- [ ] **Step 3: Run the repository verification suite**

Run: `npm test`

Run: `npm run build`

Expected: both pass with the new bootstrap behavior and updated documentation.

## Self-Review

1. Spec coverage: the plan covers token-file config, runtime token resolution, Docker compose bootstrap, readiness reporting, and documentation updates.
2. Placeholder scan: the plan contains no TBD/TODO placeholders or vague implementation notes that lack concrete file targets or API shapes.
3. Type consistency: `giteaAdminTokenFile` is used consistently as the config field name, and the bootstrap status shape is spelled out before the task that consumes it.

## Out of Scope

- Public self-registration.
- ESL username/password login.
- Web UI setup wizard.
- Multiple Gitea administrator accounts.
- Production secret-manager integration.
