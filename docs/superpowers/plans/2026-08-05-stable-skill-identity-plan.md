# Stable Skill Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skill names, local paths, and Git repository paths stable while moving all repositories under the platform-owned Gitea organization.

**Architecture:** Keep the public skill name in `@scope/skill-name` form, with the creation scope immutable. Store Git repositories under the configured platform owner `esl-skills`, using `scope_skill-name` as the repository name. Keep `createdBy`, `owner`, and `maintainers` as separate metadata so permission changes never require renaming a skill or moving a client directory.

**Tech Stack:** TypeScript strict ESM, Node.js >= 18.0.0, Fastify, better-sqlite3, Gitea REST API, Commander, Vitest, Docker Compose.

## Global Constraints

- Follow `docs/agent-coding-principles.md`.
- Keep reusable logic in `packages/core`; keep CLI parsing, output, and exit behavior in `packages/cli`.
- Do not change the public `@scope/skill-name` format.
- `scope` and `skill-name` are immutable after creation.
- The Gitea repository owner is configured as `GITEA_REPO_OWNER` and defaults to `esl-skills`.
- Clients must use the persisted or API-returned `gitRepoPath`; they must not infer it from the current owner.
- Preserve existing user changes in `package-lock.json`, `packages/server/Dockerfile`, `.dockerignore`, and `.env`.
- Verify changes with `npm test` and `npm run build`.

---

### Task 1: Preserve Scope in Local Install Paths

**Files:**
- Modify: `packages/cli/src/commands/network-options.ts`
- Create: `packages/cli/tests/network-options.test.ts`

**Interfaces:**
- Consumes: `parseSkillName(name: string)` from `@esl/core`
- Produces: `installTargetDir(name, options)` returning `<skillsDir>/@<scope>/<skillName>`

- [ ] **Step 1: Write the failing path test**

Create `packages/cli/tests/network-options.test.ts`:

```typescript
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installTargetDir } from '../src/commands/network-options.js';

describe('network option paths', () => {
  it('keeps scope in the global skill install path', () => {
    const result = installTargetDir('@alice/code-review', {
      homeDir: 'C:\\temp\\esl-home'
    });

    expect(result).toBe(
      path.join('C:\\temp\\esl-home', '.skill-library', 'skills', '@alice', 'code-review')
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx vitest run packages/cli/tests/network-options.test.ts
```

Expected: FAIL because the current implementation returns a path ending in `skills/code-review`.

- [ ] **Step 3: Implement the scoped path**

Update `installTargetDir` to parse the package name and join the scope directory:

```typescript
import { parseSkillName } from '@esl/core';
import path from 'node:path';

export function installTargetDir(skillName: string, options: LocalStoreOptions): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(resolveLocalStorePaths(options).skillsDir, `@${scope}`, shortName);
}
```

Keep all other network option behavior unchanged.

- [ ] **Step 4: Run the focused test**

Run:

```powershell
npx vitest run packages/cli/tests/network-options.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/cli/src/commands/network-options.ts packages/cli/tests/network-options.test.ts
git commit -m "fix(cli): preserve skill scope in install paths"
```

### Task 2: Route Repository Creation Through the Platform Organization

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/skills.ts`
- Modify: `packages/server/src/services/gitea.ts`
- Modify: `packages/server/tests/config.test.ts`
- Modify: `packages/server/tests/server.test.ts`
- Modify: `packages/server/tests/gitea-service.test.ts`
- Modify: `packages/server/tests/app.test.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `docs/local-dev.md`

**Interfaces:**
- Produces: `ServerConfig.repoOwner: string`
- Produces: `AppOptions.repoOwner: string`
- Produces: `GiteaService.createOrganizationRepo(owner, name, isPrivate): Promise<GiteaRepo>`
- Consumes: `GITEA_REPO_OWNER`, defaulting to `esl-skills`

- [ ] **Step 1: Add a failing config expectation**

Extend `packages/server/tests/config.test.ts` with:

```typescript
expect(config.repoOwner).toBe('esl-skills');
```

Add a second case that passes:

```typescript
GITEA_REPO_OWNER: 'platform-skills'
```

and expects `config.repoOwner` to equal `platform-skills`.

- [ ] **Step 2: Run the config test**

Run:

```powershell
npx vitest run packages/server/tests/config.test.ts
```

Expected: FAIL because `ServerConfig` does not expose `repoOwner`.

- [ ] **Step 3: Implement repository owner configuration**

In `loadServerConfig`, return:

```typescript
repoOwner: env.GITEA_REPO_OWNER ?? 'esl-skills'
```

Pass `repoOwner` from `startServer` to `buildApp`, then to `registerSkillsRoutes`.

- [ ] **Step 4: Add organization-only Gitea creation**

Add this method to `GiteaService`:

```typescript
async createOrganizationRepo(owner: string, name: string, isPrivate = false): Promise<GiteaRepo> {
  const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${owner}/repos`, {
    method: 'POST',
    headers: {
      Authorization: `token ${this.adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, private: isPrivate, auto_init: false })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Gitea organization repository: ${err}`);
  }

  return (await res.json()) as GiteaRepo;
}
```

Keep `getRepo` unchanged. The publish route must no longer call the old user-or-organization fallback.

- [ ] **Step 5: Add the Gitea service test**

Add a test that verifies `createOrganizationRepo('esl-skills', 'alice_code-review')` calls:

```text
POST /api/v1/orgs/esl-skills/repos
```

with:

```json
{
  "name": "alice_code-review",
  "private": false,
  "auto_init": false
}
```

- [ ] **Step 6: Update the publish route**

Add `repoOwner` to `SkillsRouteOptions`. When creating a first-time skill, derive the repository name from the immutable package name:

```typescript
const repoName = `${scope}_${skillName}`;
const gitRepo = await giteaService.createOrganizationRepo(
  repoOwner,
  repoName,
  visibility === 'private'
);
```

Store the returned `gitRepo.full_name` as `gitRepoPath`.

- [ ] **Step 7: Update API tests**

Update `buildApp` calls to pass `repoOwner: 'esl-skills'`. Assert that publishing `@alice/code-review` calls:

```typescript
createOrganizationRepo('esl-skills', 'alice_code-review', false)
```

and returns `gitRepoPath: 'esl-skills/alice_code-review'`.

- [ ] **Step 8: Update Docker configuration and docs**

Add to `docker-compose.yml`:

```yaml
GITEA_REPO_OWNER: ${GITEA_REPO_OWNER:-esl-skills}
```

Add to `.env.example`:

```dotenv
GITEA_REPO_OWNER=esl-skills
```

Document that the `esl-skills` organization must exist in local Gitea before publishing.

- [ ] **Step 9: Run focused server tests**

Run:

```powershell
npx vitest run packages/server/tests/config.test.ts packages/server/tests/gitea-service.test.ts packages/server/tests/app.test.ts packages/server/tests/server.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add packages/server/src packages/server/tests docker-compose.yml .env.example docs/local-dev.md
git commit -m "feat(server): use platform-owned skill repositories"
```

### Task 3: Persist Creation and Ownership Metadata

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/database.ts`
- Modify: `packages/server/src/routes/skills.ts`
- Modify: `packages/server/src/seed.ts`
- Modify: `packages/server/tests/database.test.ts`
- Modify: `packages/server/tests/app.test.ts`
- Modify: `packages/server/tests/seed.test.ts`

**Interfaces:**
- `SkillRecord` includes `createdBy: string`, `owner: string`, and `maintainers: string[]`.
- Existing `author` remains accepted in `skill.json` but is mapped to `createdBy` at publish time.
- Existing SQLite databases are upgraded without deleting data.

- [ ] **Step 1: Write metadata assertions**

Update the database test fixture to create:

```typescript
{
  name: '@alice/debugger',
  scope: 'alice',
  skillName: 'debugger',
  description: 'Debugging helper',
  createdBy: 'alice',
  owner: 'platform',
  maintainers: ['alice'],
  visibility: 'public',
  gitRepoPath: 'esl-skills/alice_debugger'
}
```

Assert that `getSkill` and `searchSkills` return the same fields.

Update the API test to assert a new skill created by `zhangsan` returns:

```json
{
  "createdBy": "zhangsan",
  "owner": "platform",
  "maintainers": ["zhangsan"]
}
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
npx vitest run packages/server/tests/database.test.ts packages/server/tests/app.test.ts
```

Expected: FAIL because the current schema and repository record do not expose the new fields.

- [ ] **Step 3: Extend the database schema**

Add these columns to new databases:

```sql
created_by TEXT NOT NULL DEFAULT '',
owner TEXT NOT NULL DEFAULT 'platform',
maintainers_json TEXT NOT NULL DEFAULT '[]'
```

In `initDatabase`, after the base schema executes, run idempotent migrations:

```typescript
function ensureColumn(db: Database.Database, column: string, definition: string): void {
  const columns = db.pragma('table_info(skills)') as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE skills ADD COLUMN ${column} ${definition}`);
  }
}
```

Ensure `created_by`, `owner`, and `maintainers_json` exist, then backfill existing rows:

```sql
UPDATE skills
SET created_by = author
WHERE created_by = '';
```

- [ ] **Step 4: Update repository serialization**

Update `SkillRecord`, inserts, selects, and search results. Serialize `maintainers` as JSON in SQLite and parse it back to `string[]`. Preserve `author` as a compatibility alias only if existing callers need it; new API responses must expose `createdBy`.

- [ ] **Step 5: Update publish and seed data**

When the authenticated user creates a new skill, persist:

```typescript
createdBy: user.username,
owner: 'platform',
maintainers: [user.username]
```

Update the development seed fixture with the same metadata shape.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx vitest run packages/server/tests/database.test.ts packages/server/tests/app.test.ts packages/server/tests/seed.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/server/src/db packages/server/src/routes/skills.ts packages/server/src/seed.ts packages/server/tests
git commit -m "feat(server): persist skill ownership metadata"
```

### Task 4: Align Publish and Install Contracts

**Files:**
- Modify: `packages/cli/src/commands/publish.ts`
- Modify: `packages/cli/src/commands/install.ts`
- Modify: `packages/cli/src/commands/info.ts`
- Modify: `packages/cli/tests/login.test.ts`
- Create: `packages/cli/tests/publish.test.ts`
- Create: `packages/cli/tests/install.test.ts`
- Modify: `docs/local-dev.md`

**Interfaces:**
- `publish` uses the API response `gitRepoPath` as the only Git repository source.
- `install` preserves scope in its destination and uses the API `gitRepoPath`.
- `info` exposes `createdBy`, `owner`, and `maintainers` without changing existing output behavior.

- [ ] **Step 1: Add a publish contract test**

Mock a valid skill directory, API response:

```json
{
  "name": "@alice/code-review",
  "gitRepoPath": "esl-skills/alice_code-review"
}
```

Assert that `executePublish`:

1. sends `POST /api/skills`;
2. calls `git remote add esl` with a URL ending in `/esl-skills/alice_code-review.git`;
3. never derives the repository path from a current owner.

- [ ] **Step 2: Run the publish test and verify failure**

Run:

```powershell
npx vitest run packages/cli/tests/publish.test.ts
```

Expected: FAIL until the test fixture and command contract are aligned.

- [ ] **Step 3: Update publish response handling**

Keep `published.gitRepoPath` required for new API responses. Remove the fallback:

```typescript
`${scope}/${skillName}`
```

If the API response has no `gitRepoPath`, throw:

```text
Failed to publish skill metadata: API response did not include gitRepoPath
```

- [ ] **Step 4: Add an install path test**

Mock `executeInfo` to return:

```json
{
  "name": "@alice/code-review",
  "gitRepoPath": "esl-skills/alice_code-review",
  "versions": ["0.1.0"]
}
```

Assert that `executeInstall` clones to:

```text
<homeDir>/.skill-library/skills/@alice/code-review
```

- [ ] **Step 5: Run focused CLI tests**

Run:

```powershell
npx vitest run packages/cli/tests/publish.test.ts packages/cli/tests/install.test.ts packages/cli/tests/network-options.test.ts
```

Expected: PASS.

- [ ] **Step 6: Update local development documentation**

Document the publish prerequisites:

- create the `esl-skills` Gitea organization;
- set `GITEA_REPO_OWNER=esl-skills`;
- create a user token for the publisher;
- ensure the API admin token can create repositories in that organization;
- run `esl validate` before `esl publish`.

- [ ] **Step 7: Commit**

```powershell
git add packages/cli/src packages/cli/tests docs/local-dev.md
git commit -m "feat(cli): publish to stable platform repository paths"
```

### Task 5: Full Verification and Local Runtime Smoke

**Files:**
- Modify: `docs/local-dev.md` only if verified commands differ.

- [ ] **Step 1: Run automated verification**

Run:

```powershell
npm test
npm run build
```

Expected: all tests pass and core/server/cli build successfully.

- [ ] **Step 2: Validate Compose configuration**

Run:

```powershell
$env:PATH='C:\Users\cnfox\AppData\Local\Programs\DockerDesktop\resources\bin;C:\Users\cnfox\AppData\Local\Programs\DockerDesktop\resources\cli-plugins;' + $env:PATH
& 'C:\Users\cnfox\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe' compose config
```

Expected: normalized configuration includes `GITEA_REPO_OWNER: esl-skills`.

- [ ] **Step 3: Run API health and seed smoke**

Run:

```powershell
& 'C:\Users\cnfox\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe' compose up -d --build
Invoke-RestMethod http://localhost:3000/health
& 'C:\Users\cnfox\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe' compose exec api npm run seed --workspace @esl/server
```

Expected: API health returns `ok=True`, seed prints `Seeded development skill metadata`.

- [ ] **Step 4: Verify scoped search and info**

Run:

```powershell
npm exec -- esl search my-skill --registry http://localhost:3000/api
npm exec -- esl info @myorg/my-skill --registry http://localhost:3000/api
```

Expected: seeded skill remains discoverable and its metadata includes `gitRepoPath`.

- [ ] **Step 5: Inspect final worktree**

Run:

```powershell
git status --short --branch
```

Expected: only explicitly retained local Docker changes and `.env` remain uncommitted.

- [ ] **Step 6: Commit final documentation corrections**

Only if `docs/local-dev.md` changed after smoke:

```powershell
git add docs/local-dev.md
git commit -m "docs: update stable skill runtime workflow"
```
