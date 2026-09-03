import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { encryptApplicationSecret } from '../src/services/application-secret.js';
import {
  initDatabase,
  OperationRepository,
  OrgApplicationRepository,
  PlatformSettingsRepository,
  SkillRepository,
  TenantOrganizationRepository
} from '../src/db/database.js';

describe('super administrator org console API', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  function superAdminGitea() {
    return {
      validateAdminUserToken: vi.fn(async (token: string) =>
        token === 'super-token' ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
      ),
      organizationExists: vi.fn().mockResolvedValue(false),
      createOrg: vi.fn().mockResolvedValue(undefined),
      createUser: vi.fn().mockResolvedValue(undefined),
      listTeams: vi.fn().mockResolvedValue([{ id: 1, name: 'Owners', permission: 'owner' }]),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      createTeam: vi.fn().mockResolvedValue({ id: 9, name: 'team', permission: 'read' }),
      listOrgs: vi.fn().mockResolvedValue([{ id: 1, name: 'acme' }]),
      listOrgMembers: vi.fn().mockResolvedValue([
        { id: 2, username: 'acme_admin', email: 'acme_admin@local.esl' },
        { id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }
      ]),
      listOrgRepos: vi.fn().mockResolvedValue([
        { id: 10, name: 'reviewer', full_name: 'acme/reviewer', clone_url: '', html_url: '' }
      ]),
      deleteRepo: vi.fn().mockResolvedValue(undefined),
      deleteUser: vi.fn().mockResolvedValue(undefined),
      deleteOrg: vi.fn().mockResolvedValue(undefined)
    };
  }

  function createPendingApplication(): void {
    const db = initDatabase(dbPath);
    new OrgApplicationRepository(db).createApplication({
      orgName: 'acme',
      adminDisplayName: 'Acme Admin',
      hashedPassword: 'hash-of-password'
    });
    db.close();
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-admin-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects non super-administrator tokens with 403', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const routes: Array<{ method: string; url: string }> = [
      { method: 'GET', url: '/api/admin/orgs/applications' },
      { method: 'POST', url: '/api/admin/orgs/applications/1/approve' },
      { method: 'POST', url: '/api/admin/orgs/applications/1/reject' },
      { method: 'GET', url: '/api/admin/orgs/settings' },
      { method: 'PUT', url: '/api/admin/orgs/settings' },
      { method: 'GET', url: '/api/admin/orgs' },
      { method: 'DELETE', url: '/api/admin/orgs/acme' }
    ];
    for (const route of routes) {
      const response = await app.inject({
        method: route.method as any,
        url: route.url,
        headers: { authorization: 'token member-token' },
        payload: { orgRegistrationMode: 'manual', confirm: 'acme' }
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('lists org applications including history without leaking password hashes', async () => {
    createPendingApplication();
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orgs/applications',
      headers: { authorization: 'token super-token' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ orgName: 'acme', adminDisplayName: 'Acme Admin', status: 'pending' });
    expect(JSON.stringify(body)).not.toContain('hash');
  });

  it('approves a pending application and triggers tenant initialization', async () => {
    createPendingApplication();
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/approve',
      headers: { authorization: 'token super-token' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('approved');
    expect(typeof body.initialPassword).toBe('string');
    expect(mockGitea.createOrg).toHaveBeenCalledWith('acme');
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_admin', body.initialPassword);
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(1, 'acme_admin');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-readers', 'read');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-writers', 'write');

    const db = initDatabase(dbPath);
    expect(new OrgApplicationRepository(db).getApplication('acme')?.status).toBe('approved');
    db.close();
  });

  it('returns 404 for an unknown application and 409 for an already processed one', async () => {
    createPendingApplication();
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const missing = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/999/approve',
      headers
    });
    expect(missing.statusCode).toBe(404);

    await app.inject({ method: 'POST', url: '/api/admin/orgs/applications/1/approve', headers });
    const repeat = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/approve',
      headers
    });
    expect(repeat.statusCode).toBe(409);
  });

  it('rejects a pending application and stores the decision', async () => {
    createPendingApplication();
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/reject',
      headers: { authorization: 'token super-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'rejected', orgName: 'acme' });
    expect(mockGitea.createOrg).not.toHaveBeenCalled();
    const db = initDatabase(dbPath);
    expect(new OrgApplicationRepository(db).getApplication('acme')?.status).toBe('rejected');
    db.close();
  });

  it('reuses the applicant password ciphertext on approval and clears it afterwards', async () => {
    const applicationEncryptionKey = 'a'.repeat(64);
    const db = initDatabase(dbPath);
    new OrgApplicationRepository(db).createApplication({
      orgName: 'acme',
      adminDisplayName: 'Acme Admin',
      encryptedPassword: encryptApplicationSecret('applicant-password-123', applicationEncryptionKey)
    });
    db.close();

    const mockGitea = superAdminGitea();
    mockGitea.listOrgMembers.mockResolvedValue([]);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/approve',
      headers: { authorization: 'token super-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'provisioning', orgName: 'acme' });
    await new Promise((resolve) => setImmediate(resolve));
    // 复用申请人提交的初始密码,不重新生成
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_admin', 'applicant-password-123');
    // 开通成功后立即清除密码密文
    const after = initDatabase(dbPath);
    expect(after.prepare('SELECT encrypted_password FROM org_applications WHERE org_name = ?').get('acme')).toEqual({
      encrypted_password: null
    });
    after.close();
  });

  it('reads and updates the registration mode setting', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const initial = await app.inject({ method: 'GET', url: '/api/admin/orgs/settings', headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ orgRegistrationMode: 'auto' });

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { orgRegistrationMode: 'manual' }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ orgRegistrationMode: 'manual' });

    const reread = await app.inject({ method: 'GET', url: '/api/admin/orgs/settings', headers });
    expect(reread.json()).toEqual({ orgRegistrationMode: 'manual' });

    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { orgRegistrationMode: 'whenever' }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('lists all organizations with member and skill counts', async () => {
    const seed = initDatabase(dbPath);
    new SkillRepository(seed).createServerSkill({
      name: '@acme/reviewer',
      scope: 'acme',
      skillName: 'reviewer',
      description: 'Reviewer skill',
      createdBy: 'acme_admin',
      owner: 'acme_admin',
      maintainers: ['acme_admin'],
      visibility: 'private',
      gitRepoPath: 'acme/reviewer',
      status: 'active-published'
    });
    seed.close();

    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orgs',
      headers: { authorization: 'token super-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ name: 'acme', memberCount: 2, skillCount: 1 }]);
  });

  it('deletes an organization with a matching confirm guard', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    new SkillRepository(db).createServerSkill({
      name: '@acme/reviewer',
      scope: 'acme',
      skillName: 'reviewer',
      description: 'Reviewer skill',
      createdBy: 'acme_admin',
      owner: 'acme_admin',
      maintainers: ['acme_admin'],
      visibility: 'private',
      gitRepoPath: 'acme/reviewer',
      status: 'active-published'
    });
    // 组织专属账号的删除要求具备 member.create 的 Resource Provenance。
    new OperationRepository(db).createOperation({
      idempotencyKey: 'member.create:acme:acme_bob',
      kind: 'member.create',
      payload: { orgName: 'acme', username: 'acme_bob' }
    });
    db.close();

    mockGitea.organizationExists.mockResolvedValue(true);
    const mismatch = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers,
      payload: { confirm: 'wrong' }
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();

    const matched = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers,
      payload: { confirm: 'acme' }
    });
    expect(matched.statusCode).toBe(202);
    expect(matched.json()).toMatchObject({ status: 'deleting', orgName: 'acme' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockGitea.listOrgRepos).toHaveBeenCalledWith('acme');
    expect(mockGitea.deleteRepo).toHaveBeenCalledWith('acme', 'reviewer');
    expect(mockGitea.deleteUser).toHaveBeenCalledWith('acme_admin');
    expect(mockGitea.deleteUser).toHaveBeenCalledWith('acme_bob');
    expect(mockGitea.deleteOrg).toHaveBeenCalledWith('acme');

    // 删除组织应同步清空平台库中的技能记录
    const after = initDatabase(dbPath);
    expect(new SkillRepository(after).getSkill('@acme/reviewer')).toBeUndefined();
    expect(after.prepare('SELECT status FROM tenant_organizations WHERE org_name = ?').get('acme')).toEqual({
      status: 'deleted'
    });
    after.close();
  });

  it('returns 404 when deleting an organization that does not exist', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/ghost',
      headers: { authorization: 'token super-token' },
      payload: { confirm: 'ghost' }
    });

    expect(response.statusCode).toBe(404);
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();
  });
});
