# Gitea Admin Password Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the admin password command to `esl admin gitea password` and make it change the Gitea service admin password through ESL.

**Architecture:** Keep ESL CLI authentication token-based and let the current platform administrator invoke a focused admin endpoint. The CLI command will call a server route dedicated to the Gitea recovery/admin password, and the server route will translate that request into a Gitea admin API call. This plan does not expand ESL into a general password-login system.

**Tech Stack:** TypeScript, Commander, Fastify, better-sqlite3, Vitest, Gitea REST API.

## Global Constraints

- CLI authentication uses tokens by default.
- The administrator's first login uses the bootstrap token.
- The registry is stored in the client configuration and does not need to be repeated for every admin command.
- Gitea bootstrap remains an internal runtime concern.

---

### Task 1: Rename the CLI command surface

**Files:**
- Modify: `packages/cli/src/bin/esl.ts`
- Modify: `packages/cli/src/commands/admin.ts`
- Modify: `packages/cli/tests/admin.test.ts`
- Modify: `docs/local-dev.md`

**Interfaces:**
- Consumes: existing admin command configuration helpers from `packages/cli/src/commands/admin.ts`
- Produces: `executeGiteaPasswordChange(options)` that backs `esl admin gitea password`

- [ ] **Step 1: Write the failing CLI test**

Add a test that invokes the admin password command through the command helper and expects the new command name to be `esl admin gitea password`.

```ts
it('changes the Gitea admin password', async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ passwordChanged: true })
  });

  await executeGiteaPasswordChange({
    homeDir,
    password: 'new-password',
    customFetch: mockFetch as any
  });

  expect(mockFetch).toHaveBeenCalledWith('http://skills.company.com/api/admin/gitea/password', {
    method: 'POST',
    headers: {
      Authorization: 'token bootstrap-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password: 'new-password' })
  });
});
```

- [ ] **Step 2: Run the CLI test and confirm it fails**

Run: `npm test -- packages/cli/tests/admin.test.ts`

Expected: the test fails because the CLI does not yet expose `admin gitea password`.

- [ ] **Step 3: Rename the command and helper**

Update the commander tree in `packages/cli/src/bin/esl.ts` so the nested command becomes `admin gitea password`. Keep the existing `--password` flag for the first pass so the command stays script-friendly without adding a prompt dependency.

```ts
admin
  .command('gitea')
  .command('password')
  .requiredOption('--password <password>', 'new Gitea administrator password')
```

Rename the helper in `packages/cli/src/commands/admin.ts` to `executeGiteaPasswordChange` and point it at the new route path.

```ts
export async function executeGiteaPasswordChange(options: ChangePasswordOptions): Promise<void> {
  // POST /api/admin/gitea/password
}
```

- [ ] **Step 4: Re-run the CLI test and confirm it passes**

Run: `npm test -- packages/cli/tests/admin.test.ts`

Expected: pass, with the command name and request payload both matching the new surface.

### Task 2: Make the server update the Gitea password for real

**Files:**
- Modify: `packages/server/src/routes/admin.ts`
- Modify: `packages/server/src/services/gitea.ts`
- Modify: `packages/server/tests/admin.test.ts`
- Modify: `packages/server/tests/gitea-service.test.ts`

**Interfaces:**
- Consumes: `giteaService` from the server app bootstrap
- Produces: `GiteaService.changeUserPassword(username: string, password: string): Promise<void>` and `POST /api/admin/gitea/password`

- [ ] **Step 1: Write the failing server tests**

Add a route test that posts to `/api/admin/gitea/password`, authorizes with the bootstrap token, and verifies that the Gitea service password update is called for the fixed admin account.

```ts
it('changes the Gitea admin password', async () => {
  const giteaService = {
    ...baseGiteaService,
    changeUserPassword: vi.fn().mockResolvedValue(undefined)
  };

  const app = buildTestApp({ giteaService });
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/gitea/password',
    headers: { authorization: 'token bootstrap-token' },
    payload: { password: 'new-password' }
  });

  expect(response.statusCode).toBe(200);
  expect(giteaService.changeUserPassword).toHaveBeenCalledWith('admin', 'new-password');
});
```

Add a Gitea service test for the new password update method, using the Gitea admin API endpoint that updates the target user password.

```ts
it('changes a user password via the Gitea admin API', async () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
  const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

  await gitea.changeUserPassword('admin', 'new-password');

  expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/users/admin', {
    method: 'PATCH',
    headers: {
      Authorization: 'token admin-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password: 'new-password' })
  });
});
```

- [ ] **Step 2: Run the server tests and confirm they fail**

Run: `npm test -- packages/server/tests/admin.test.ts packages/server/tests/gitea-service.test.ts`

Expected: failures showing the route and service method do not exist yet.

- [ ] **Step 3: Implement the server route and Gitea service method**

Add `changeUserPassword` to `packages/server/src/services/gitea.ts` and route `POST /api/admin/gitea/password` in `packages/server/src/routes/admin.ts`. Keep the authorization model the same as the other admin routes: only the current platform administrator token can call it.

Use the fixed bootstrap admin account name that ESL already uses today (`admin`) so the command stays short and does not grow a separate username configuration surface.

```ts
await giteaService.changeUserPassword('admin', password);
return { passwordChanged: true };
```

- [ ] **Step 4: Re-run the server tests and confirm they pass**

Run: `npm test -- packages/server/tests/admin.test.ts packages/server/tests/gitea-service.test.ts`

Expected: pass, with the route calling Gitea instead of only updating local state.

### Task 3: Align docs and spec text with the new command

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-admin-command-boundary-design.md`
- Modify: `.scratch/admin-command-boundary/spec.md`
- Modify: `.scratch/admin-command-boundary/issues/05-admin-password-change.md`
- Modify: `docs/local-dev.md`

**Interfaces:**
- Consumes: the new `esl admin gitea password` command name
- Produces: docs that describe Gitea password rotation explicitly and no longer mention the old generic password command

- [ ] **Step 1: Update the documentation examples**

Replace the old generic admin password wording with `esl admin gitea password` in the user-facing docs and issue tracker files. Keep the surrounding explanation focused on Gitea recovery/admin password rotation, not ESL CLI login.

```powershell
npm exec -- esl admin gitea password --password <new-password>
```

- [ ] **Step 2: Reconcile the spec wording**

Rewrite the spec entry so it says the command changes the Gitea service admin password and remains a narrow recovery-path operation. Leave the broader Gitea bootstrap work in its existing ticket.

- [ ] **Step 3: Run the repository verification suite**

Run: `npm test`

Run: `npm run build`

Expected: both pass with the renamed command surface and updated docs in place.

## Self-Review

1. Spec coverage: the plan covers the command rename, the real server-side password update, and the doc/spec text that still names the old command.
2. Placeholder scan: no TBD/TODO/future-work placeholders remain in the task steps.
3. Type consistency: `executeGiteaPasswordChange` is the CLI helper name used consistently across the CLI task and the tests; `changeUserPassword(username, password)` is the server-side Gitea API helper used consistently across server tasks and tests.

## Out of Scope

- Automatic Docker bootstrap of Gitea service admin creation and default organization setup.
- ESL username/password login.
- Any general-purpose Gitea administration commands beyond password rotation.
