import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';

describe('login with an omitted organization resolving through the default org', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  function makeGiteaMock(overrides: Record<string, unknown> = {}) {
    return {
      validateAdminUserToken: vi.fn(async (token: string) =>
        token === 'super-token' ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
      ),
      adminUsername: 'eslroot',
      loginUser: vi.fn().mockResolvedValue('gitea-token'),
      listOrgMembers: vi.fn().mockResolvedValue([
        { username: 'acme_admin' },
        { username: 'acme_alice' }
      ]),
      ...overrides
    };
  }

  async function setDefaultOrg(orgName: string): Promise<void> {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName, status: 'active' });
    db.close();
    const res = await app!.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: { authorization: 'token super-token' },
      payload: { defaultOrg: orgName }
    });
    expect(res.statusCode).toBe(200);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-login-default-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves an omitted org to the default org on the CLI login endpoint', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setDefaultOrg('acme');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({
      token: 'gitea-token',
      username: 'admin',
      org: 'acme',
      role: 'org-admin'
    });
    expect(mockGitea.loginUser).toHaveBeenCalledWith('acme_admin', 'correct-password');
  });

  it('still requires an org on the CLI endpoint when no default org is set', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'whatever' }
    });

    expect(loginRes.statusCode).toBe(400);
    expect(loginRes.json().error).toContain('Organization');
    expect(mockGitea.loginUser).not.toHaveBeenCalled();
  });

  it('resolves an omitted org to the default org on the console endpoint for a member', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setDefaultOrg('acme');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'alice', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({
      token: 'gitea-token',
      username: 'alice',
      org: 'acme',
      role: 'member'
    });
    expect(mockGitea.loginUser).toHaveBeenCalledWith('acme_alice', 'correct-password');
  });

  it('resolves a system management team member to org-admin on console login', async () => {
    const mockGitea = makeGiteaMock({
      listTeams: vi.fn().mockResolvedValue([
        { id: 1, name: 'Owners', permission: 'owner' },
        { id: 5, name: 'system-admins', permission: 'admin' }
      ]),
      isTeamMember: vi.fn().mockResolvedValue(true)
    });
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setDefaultOrg('acme');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'alice', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({
      token: 'gitea-token',
      username: 'alice',
      org: 'acme',
      role: 'org-admin'
    });
    expect(mockGitea.isTeamMember).toHaveBeenCalledWith(5, 'acme_alice');
  });

  it('resolves a system management team member to org-admin on CLI login', async () => {
    const mockGitea = makeGiteaMock({
      listTeams: vi.fn().mockResolvedValue([
        { id: 1, name: 'Owners', permission: 'owner' },
        { id: 5, name: 'system-admins', permission: 'admin' }
      ]),
      isTeamMember: vi.fn().mockResolvedValue(true)
    });
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setDefaultOrg('acme');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({
      token: 'gitea-token',
      username: 'alice',
      org: 'acme',
      role: 'org-admin'
    });
  });

  it('still resolves the platform administrator to super when omitting org with a default org set', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setDefaultOrg('acme');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'eslroot', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({ token: 'gitea-token', username: 'eslroot', org: null, role: 'super' });
    expect(mockGitea.loginUser).toHaveBeenCalledWith('eslroot', 'correct-password');
  });

  it('rejects an org-less account that is not the admin and not a default-org member', async () => {
    const mockGitea = makeGiteaMock({
      listOrgMembers: vi.fn().mockResolvedValue([{ username: 'acme_admin' }, { username: 'acme_alice' }])
    });
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setDefaultOrg('acme');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'bob', password: 'whatever' }
    });

    expect(loginRes.statusCode).toBe(403);
    expect(loginRes.json().error).toContain('not a member');
    expect(mockGitea.loginUser).toHaveBeenCalledWith('acme_bob', 'whatever');
  });

  it('honors an explicit org even when a default org is set', async () => {
    const mockGitea = makeGiteaMock({
      listOrgMembers: vi.fn().mockResolvedValue([{ username: 'other_alice' }])
    });
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setDefaultOrg('acme');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { org: 'other', username: 'alice', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toMatchObject({ org: 'other', role: 'member' });
    expect(mockGitea.loginUser).toHaveBeenCalledWith('other_alice', 'correct-password');
  });
});
