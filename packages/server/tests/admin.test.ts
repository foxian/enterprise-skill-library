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

  it('changes the ESL Administrator Account password with its own token', async () => {
    const changeAdminPassword = vi.fn().mockResolvedValue(undefined);
    const validateAdminUserToken = vi.fn().mockResolvedValue({ username: 'eslroot' });
    app = buildApp({
      dbPath,
      giteaService: { changeAdminPassword, validateAdminUserToken } as any,
      repoOwner: 'esl-skills'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/account/password',
      headers: { authorization: 'token administrator-account-token' },
      payload: { password: 'new-password' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ passwordChanged: true });
    expect(validateAdminUserToken).toHaveBeenCalledWith('administrator-account-token');
    expect(changeAdminPassword).toHaveBeenCalledWith('new-password');
  });

  it('rejects a non-administrator token when changing the ESL Administrator Account password', async () => {
    const changeAdminPassword = vi.fn().mockResolvedValue(undefined);
    const validateAdminUserToken = vi.fn().mockResolvedValue(null);
    app = buildApp({
      dbPath,
      giteaService: { changeAdminPassword, validateAdminUserToken } as any,
      repoOwner: 'esl-skills'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/account/password',
      headers: { authorization: 'token bootstrap-token' },
      payload: { password: 'new-password' }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Administrator account login required to change its password'
    });
    expect(changeAdminPassword).not.toHaveBeenCalled();
  });

  it('does not retain the old Gitea-named password route', async () => {
    const changeAdminPassword = vi.fn().mockResolvedValue(undefined);
    app = buildApp({
      dbPath,
      giteaService: { changeAdminPassword } as any,
      repoOwner: 'esl-skills'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/gitea/password',
      headers: { authorization: 'token administrator-account-token' },
      payload: { password: 'new-password' }
    });

    expect(response.statusCode).toBe(404);
    expect(changeAdminPassword).not.toHaveBeenCalled();
  });
});
