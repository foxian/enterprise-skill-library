import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';

// 平台设置（ADR-0032）：部署模式与默认组织（ADR-0022）已废除，
// 超管可配置 org_registration_mode、registration_mode；platform-info 匿名暴露 registrationMode。
describe('platform settings', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;
  let superToken: string;
  let gitea: any;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-platform-settings-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = {
      validateAdminUserToken: vi.fn(async (token: string) =>
        token === superToken ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
      ),
      adminUsername: 'eslroot',
      getUser: vi.fn(async (username: string) =>
        username === 'eslroot' ? { id: 1, username, email: 'eslroot@local.esl' } : null
      ),
      createUser: vi.fn().mockResolvedValue(undefined),
      disableUser: vi.fn().mockResolvedValue(undefined),
      organizationExists: vi.fn().mockResolvedValue(false),
      createOrg: vi.fn().mockResolvedValue(undefined),
      listTeams: vi.fn().mockResolvedValue([{ id: 1, name: 'Owners', permission: 'owner' }]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      createTeam: vi.fn().mockResolvedValue({ id: 5, name: 'dev', permission: 'read' })
    };
    const tokenDb = initDatabase(dbPath);
    tokenDb.close();
    superToken = 'super-token';
    app = await buildApp({ dbPath, giteaService: gitea, repoOwner: 'esl-skills' });
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const headers = () => ({ authorization: `token ${superToken}` });

  it('exposes registrationMode anonymously and defaults to open', async () => {
    const info = await app!.inject({ method: 'GET', url: '/api/public/platform-info' });

    expect(info.statusCode).toBe(200);
    expect(info.json()).toEqual({ registrationMode: 'open', memberAddMode: 'direct' });
  });

  it('lets the super administrator switch org_registration_mode', async () => {
    const initial = await app!.inject({ method: 'GET', url: '/api/admin/orgs/settings', headers: headers() });
    expect(initial.json()).toEqual({ orgRegistrationMode: 'auto', registrationMode: 'open' });

    const updated = await app!.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: headers(),
      payload: { orgRegistrationMode: 'manual' }
    });
    expect(updated.json()).toEqual({ orgRegistrationMode: 'manual', registrationMode: 'open' });

    const reread = await app!.inject({ method: 'GET', url: '/api/admin/orgs/settings', headers: headers() });
    expect(reread.json()).toEqual({ orgRegistrationMode: 'manual', registrationMode: 'open' });
  });

  it('rejects invalid mode values', async () => {
    const orgMode = await app!.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: headers(),
      payload: { orgRegistrationMode: 'whenever' }
    });
    expect(orgMode.statusCode).toBe(400);

    const regMode = await app!.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: headers(),
      payload: { registrationMode: 'whenever' }
    });
    expect(regMode.statusCode).toBe(400);
  });
});
