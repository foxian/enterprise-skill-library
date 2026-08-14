import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Admin API', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-admin-api-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports bootstrap readiness', async () => {
    const mockGitea = {
      getBootstrapStatus: async () => ({
        ready: true,
        gitea: 'ready',
        adminToken: 'ready',
        repoOwner: 'ready'
      }),
      isReady: async () => true,
      validateAdminToken: async () => true,
      organizationExists: async () => true
    };
    app = buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills'
    });

    const response = await app.inject({ method: 'GET', url: '/api/admin/bootstrap/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ready: true,
      gitea: 'ready',
      adminToken: 'ready',
      repoOwner: 'ready'
    });
  });

  it('reports bootstrap not ready when the repo owner organization is missing', async () => {
    const mockGitea = {
      getBootstrapStatus: async () => ({
        ready: false,
        gitea: 'ready',
        adminToken: 'ready',
        repoOwner: 'missing'
      }),
      isReady: async () => true,
      validateAdminToken: async () => true,
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
      gitea: 'ready',
      adminToken: 'ready',
      repoOwner: 'missing'
    });
  });

  it('creates a user and issues a login token', async () => {
    const mockGitea = {
      organizationExists: async () => true,
      createUser: async () => undefined,
      issueUserToken: async () => 'gitea-user-token'
    };
    app = buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills'
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token bootstrap-token' },
      payload: { username: 'alice' }
    });

    expect(createRes.statusCode).toBe(201);
    expect(createRes.json()).toEqual({ username: 'alice', disabled: false });

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/tokens',
      headers: { authorization: 'token bootstrap-token' }
    });

    expect(tokenRes.statusCode).toBe(201);
    expect(tokenRes.json().token).toBe('gitea-user-token');
  });

  it('disables a user', async () => {
    const mockGitea = {
      organizationExists: async () => true,
      createUser: async () => undefined,
      issueUserToken: async () => 'gitea-user-token',
      disableUser: async () => undefined
    };
    app = buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills'
    });

    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token bootstrap-token' },
      payload: { username: 'alice' }
    });

    const disableRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/disable',
      headers: { authorization: 'token bootstrap-token' }
    });

    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json()).toEqual({ username: 'alice', disabled: true });

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/tokens',
      headers: { authorization: 'token bootstrap-token' }
    });

    expect(tokenRes.statusCode).toBe(400);
  });

  it('allows issued user tokens for skill operations until the user is disabled', async () => {
    const mockGitea = {
      organizationExists: async () => true,
      createUser: async () => undefined,
      issueUserToken: async () => 'gitea-user-token',
      disableUser: async () => undefined,
      createOrganizationRepo: async () => ({ full_name: 'esl-skills/alice_demo' })
    };
    app = buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills'
    });

    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token bootstrap-token' },
      payload: { username: 'alice' }
    });
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/tokens',
      headers: { authorization: 'token bootstrap-token' }
    });
    const userToken = tokenRes.json().token as string;

    const createSkillRes = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: `token ${userToken}` },
      payload: {
        name: '@alice/demo',
        version: '0.1.0',
        description: 'Demo skill',
        author: 'alice'
      }
    });

    expect(createSkillRes.statusCode).toBe(201);
    expect(createSkillRes.json().createdBy).toBe('alice');

    await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/disable',
      headers: { authorization: 'token bootstrap-token' }
    });

    const disabledRes = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: `token ${userToken}` },
      payload: {
        name: '@alice/blocked',
        version: '0.1.0',
        description: 'Blocked skill',
        author: 'alice'
      }
    });

    expect(disabledRes.statusCode).toBe(401);
    expect(disabledRes.json()).toEqual({ error: 'Unauthorized: invalid token' });
  });

  it('changes the Gitea administrator password', async () => {
    const changeAdminPassword = vi.fn().mockResolvedValue(undefined);
    app = buildApp({
      dbPath,
      giteaService: { changeAdminPassword } as any,
      repoOwner: 'esl-skills'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/gitea/password',
      headers: { authorization: 'token bootstrap-token' },
      payload: { password: 'new-password' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ passwordChanged: true });
    expect(changeAdminPassword).toHaveBeenCalledWith('new-password');
  });

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
});
