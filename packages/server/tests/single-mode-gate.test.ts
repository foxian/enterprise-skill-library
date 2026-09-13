import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';

describe('single-organization mode gate', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  function makeGiteaMock() {
    return {
      validateAdminUserToken: vi.fn(async (token: string) =>
        token === 'super-token' ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
      ),
      adminUsername: 'eslroot',
      loginUser: vi.fn().mockResolvedValue('gitea-token'),
      listOrgMembers: vi.fn().mockResolvedValue([{ username: 'acme_admin' }, { username: 'acme_alice' }]),
      validateToken: vi.fn(async (token: string) => {
        if (token === 'default-token') return { username: 'acme_alice' };
        if (token === 'frozen-token') return { username: 'other_alice' };
        return null;
      })
    };
  }

  async function setSingleMode(defaultOrg: string): Promise<void> {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: defaultOrg, status: 'active' });
    db.close();
    const res = await app!.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: { authorization: 'token super-token' },
      payload: { deploymentMode: 'single', defaultOrg }
    });
    expect(res.statusCode).toBe(200);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-single-mode-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 全局身份登录（ADR-0032）后登录请求不再携带组织字段，登录门禁移除；
  // 单组织模式的边界由存量 token 门禁（下方用例）继续把守。
  it('rejects an existing token of a frozen-org member immediately on a skill route', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setSingleMode('acme');

    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=x',
      headers: { authorization: 'token frozen-token' }
    });

    expect(searchRes.statusCode).toBe(403);
    expect(searchRes.json().error).toContain('single-organization');
  });

  it('keeps a default-org member token working on a skill route in single mode', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setSingleMode('acme');

    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=x',
      headers: { authorization: 'token default-token' }
    });

    expect(searchRes.statusCode).toBe(200);
  });

  it('keeps the platform administrator token working in single mode', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setSingleMode('acme');

    const settingsRes = await app.inject({
      method: 'GET',
      url: '/api/admin/orgs/settings',
      headers: { authorization: 'token super-token' }
    });

    expect(settingsRes.statusCode).toBe(200);
  });

  it('does not gate frozen-org tokens while in multi mode', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=x',
      headers: { authorization: 'token frozen-token' }
    });

    expect(searchRes.statusCode).toBe(200);
  });

  it('keeps anonymous endpoints reachable in single mode', async () => {
    const mockGitea = makeGiteaMock();
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    await setSingleMode('acme');

    const info = await app.inject({ method: 'GET', url: '/api/public/platform-info' });

    expect(info.statusCode).toBe(200);
    expect(info.json()).toEqual({ mode: 'single', defaultOrg: 'acme' });
  });
});
