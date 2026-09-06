import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';

describe('platform deployment mode and default organization', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  function superAdminGitea() {
    return {
      validateAdminUserToken: vi.fn(async (token: string) =>
        token === 'super-token' ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
      ),
      validateToken: vi.fn().mockResolvedValue(null),
      adminUsername: 'eslroot'
    };
  }

  function createActiveTenant(orgName: string): void {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName, status: 'active' });
    db.close();
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-platform-settings-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exposes platform-info anonymously with multi mode and no default org by default', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({ method: 'GET', url: '/api/public/platform-info' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: 'multi', defaultOrg: null });
  });

  it('lets the super administrator set the default org and reflects it in platform-info', async () => {
    createActiveTenant('acme');
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const set = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { defaultOrg: 'acme' }
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ deploymentMode: 'multi', defaultOrg: 'acme' });

    const info = await app.inject({ method: 'GET', url: '/api/public/platform-info' });
    expect(info.json()).toEqual({ mode: 'multi', defaultOrg: 'acme' });
  });

  it('switching to single requires a default org and performs the switch atomically', async () => {
    createActiveTenant('acme');
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const rejected = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { deploymentMode: 'single' }
    });
    expect(rejected.statusCode).toBe(400);

    const switched = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { deploymentMode: 'single', defaultOrg: 'acme' }
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toMatchObject({ deploymentMode: 'single', defaultOrg: 'acme' });

    const info = await app.inject({ method: 'GET', url: '/api/public/platform-info' });
    expect(info.json()).toEqual({ mode: 'single', defaultOrg: 'acme' });
  });

  it('keeps the default org when switching back to multi', async () => {
    createActiveTenant('acme');
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { deploymentMode: 'single', defaultOrg: 'acme' }
    });
    const back = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { deploymentMode: 'multi' }
    });
    expect(back.statusCode).toBe(200);
    expect(back.json()).toMatchObject({ deploymentMode: 'multi', defaultOrg: 'acme' });
  });

  it('rejects a default org that is not an active tenant organization', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { defaultOrg: 'ghost' }
    });
    expect(response.statusCode).toBe(400);
  });

  it('blocks deleting the default organization', async () => {
    createActiveTenant('acme');
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };
    await app.inject({ method: 'PUT', url: '/api/admin/orgs/settings', headers, payload: { defaultOrg: 'acme' } });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers,
      payload: { confirm: 'acme' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('default');
  });

  it('requires an explicit confirm when reassigning the default org in single mode', async () => {
    createActiveTenant('acme');
    createActiveTenant('beta');
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };
    await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { deploymentMode: 'single', defaultOrg: 'acme' }
    });

    const withoutConfirm = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { defaultOrg: 'beta' }
    });
    expect(withoutConfirm.statusCode).toBe(400);

    const withConfirm = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { defaultOrg: 'beta', confirm: 'beta' }
    });
    expect(withConfirm.statusCode).toBe(200);
    expect(withConfirm.json()).toMatchObject({ deploymentMode: 'single', defaultOrg: 'beta' });
  });

  it('does not require a confirm when reassigning the default org in multi mode', async () => {
    createActiveTenant('acme');
    createActiveTenant('beta');
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    await app.inject({ method: 'PUT', url: '/api/admin/orgs/settings', headers, payload: { defaultOrg: 'acme' } });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { defaultOrg: 'beta' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ deploymentMode: 'multi', defaultOrg: 'beta' });
  });

  it('rejects clearing the default org in single mode without corrupting the existing default', async () => {
    createActiveTenant('acme');
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };
    await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { deploymentMode: 'single', defaultOrg: 'acme' }
    });

    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { defaultOrg: null }
    });
    expect(cleared.statusCode).toBe(400);

    const info = await app.inject({ method: 'GET', url: '/api/public/platform-info' });
    expect(info.json()).toEqual({ mode: 'single', defaultOrg: 'acme' });
  });

  it('cannot bypass the reassign confirm by repeating deploymentMode single while already in single mode', async () => {
    createActiveTenant('acme');
    createActiveTenant('beta');
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };
    await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { deploymentMode: 'single', defaultOrg: 'acme' }
    });

    const bypassed = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { defaultOrg: 'beta', deploymentMode: 'single' }
    });
    expect(bypassed.statusCode).toBe(400);
    expect(bypassed.json().error).toContain('confirm');
  });
});
