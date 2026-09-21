import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

describe('super administrator user management', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;
  let superToken: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-user-management-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'eslroot', password: 'root-password', email: 'root@example.com' },
        { username: 'alice', password: 'alice-password', email: 'alice@example.com' },
        { username: 'bob', password: 'bob-password', email: 'bob@example.com' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.setOrgOwner('acme', 'alice');
    superToken = (await gitea.loginUser('eslroot', 'root-password'))!;
    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const headers = () => ({ authorization: `token ${superToken}` });

  it('lists Skill Users with email and enablement while excluding the platform administrator', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: headers()
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        username: 'alice',
        email: 'alice@example.com',
        enabled: true,
        emailPendingCompletion: false
      },
      {
        username: 'bob',
        email: 'bob@example.com',
        enabled: true,
        emailPendingCompletion: false
      }
    ]);
  });

  it('searches by username or email and filters enabled or disabled users', async () => {
    await gitea.disableUser('bob');

    const byUsername = await app.inject({
      method: 'GET',
      url: '/api/admin/users?search=ali',
      headers: headers()
    });
    expect(byUsername.json().map((user: { username: string }) => user.username)).toEqual(['alice']);

    const byEmail = await app.inject({
      method: 'GET',
      url: '/api/admin/users?search=bob%40example.com',
      headers: headers()
    });
    expect(byEmail.json().map((user: { username: string }) => user.username)).toEqual(['bob']);

    const disabled = await app.inject({
      method: 'GET',
      url: '/api/admin/users?status=disabled',
      headers: headers()
    });
    expect(disabled.json()).toEqual([
      {
        username: 'bob',
        email: 'bob@example.com',
        enabled: false,
        emailPendingCompletion: false
      }
    ]);
  });

  it('marks legacy synthetic emails as pending completion', async () => {
    await gitea.createUser('legacy', 'legacy-password');

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users?search=legacy',
      headers: headers()
    });

    expect(res.json()).toEqual([
      {
        username: 'legacy',
        email: 'legacy@local.esl',
        enabled: true,
        emailPendingCompletion: true
      }
    ]);
  });

  it('provisions an active user without registration approval and snapshots the default password-change policy', async () => {
    const mode = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: headers(),
      payload: { registrationMode: 'approval' }
    });
    expect(mode.statusCode).toBe(200);

    const provisioned = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: headers(),
      payload: {
        username: 'dave',
        password: 'initial-password',
        email: 'dave@example.com'
      }
    });

    expect(provisioned.statusCode).toBe(201);
    expect(provisioned.json()).toEqual({
      username: 'dave',
      email: 'dave@example.com',
      enabled: true,
      emailPendingCompletion: false
    });
    expect(await gitea.loginUser('dave', 'initial-password')).toEqual(expect.any(String));
    expect(gitea.__state.mustChangePasswords.get('dave')).toBe(true);
  });

  it('snapshots a changed password policy only for later provisioning', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: headers(),
      payload: {
        username: 'first',
        password: 'initial-password',
        email: 'first@example.com'
      }
    });
    const policy = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: headers(),
      payload: { adminProvisionedPasswordChangePolicy: 'allow' }
    });
    expect(policy.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: headers(),
      payload: {
        username: 'second',
        password: 'initial-password',
        email: 'second@example.com'
      }
    });

    expect(gitea.__state.mustChangePasswords.get('first')).toBe(true);
    expect(gitea.__state.mustChangePasswords.get('second')).toBe(false);
  });

  it('disables and re-enables a user while revoking old tokens and retaining account relationships', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'alice', password: 'alice-password' }
    });
    const oldToken = login.json().token as string;

    const disabled = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/disable',
      headers: headers()
    });

    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ username: 'alice', enabled: false });
    expect(await gitea.validateToken(oldToken)).toBeNull();
    expect((await gitea.listOrgOwners('acme')).some((user) => user.username === 'alice')).toBe(true);
    expect(await gitea.getUser('alice')).not.toBeNull();

    const blockedLogin = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'alice', password: 'alice-password' }
    });
    expect(blockedLogin.statusCode).toBe(401);

    const enabled = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/enable',
      headers: headers()
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({ username: 'alice', enabled: true });
    expect(await gitea.validateToken(oldToken)).toBeNull();

    const freshLogin = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'alice', password: 'alice-password' }
    });
    expect(freshLogin.statusCode).toBe(200);
    expect(freshLogin.json().token).not.toBe(oldToken);
  });

  it('changes any Skill User email without the target password while enforcing global uniqueness', async () => {
    const changed = await app.inject({
      method: 'PUT',
      url: '/api/admin/users/bob/email',
      headers: headers(),
      payload: { email: 'bob.new@example.com' }
    });

    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      username: 'bob',
      email: 'bob.new@example.com',
      enabled: true
    });
    expect(await gitea.getUser('bob')).toMatchObject({ email: 'bob.new@example.com' });

    const duplicate = await app.inject({
      method: 'PUT',
      url: '/api/admin/users/bob/email',
      headers: headers(),
      payload: { email: 'alice@example.com' }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('emailAlreadyTaken');

    const administrator = await app.inject({
      method: 'PUT',
      url: '/api/admin/users/eslroot/email',
      headers: headers(),
      payload: { email: 'root.new@example.com' }
    });
    expect(administrator.statusCode).toBe(403);
  });

  it('keeps pending user registrations in the approval workflow instead of user management', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: headers(),
      payload: { registrationMode: 'approval' }
    });
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'pending-user',
        password: 'pending-password',
        email: 'pending@example.com'
      }
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users?status=disabled',
      headers: headers()
    });
    expect(list.json().some((user: { username: string }) => user.username === 'pending-user')).toBe(false);

    const enable = await app.inject({
      method: 'POST',
      url: '/api/admin/users/pending-user/enable',
      headers: headers()
    });
    expect(enable.statusCode).toBe(409);
    expect(enable.json().code).toBe('pendingRegistrationMustBeProcessedFromUserRegistrationApproval');
  });

  it('rejects non-superadministrator callers on user-management APIs', async () => {
    const userToken = (await gitea.loginUser('bob', 'bob-password'))!;
    const userHeaders = { authorization: `token ${userToken}` };

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: userHeaders
    });
    expect(list.statusCode).toBe(403);

    const disable = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/disable',
      headers: userHeaders
    });
    expect(disable.statusCode).toBe(403);
  });
});
