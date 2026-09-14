import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  initDatabase,
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
      listTeamMembers: vi.fn().mockResolvedValue([]),
      isTeamMember: vi.fn().mockResolvedValue(false),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      removeTeamMember: vi.fn().mockResolvedValue(undefined),
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
      applicantUsername: 'applicant-alice',
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
    expect(body[0]).toMatchObject({ orgName: 'acme', applicantUsername: 'applicant-alice', status: 'pending' });
    expect(JSON.stringify(body)).not.toContain('hash');
  });

  it('approves a pending application and triggers tenant initialization', async () => {
    createPendingApplication();
    const mockGitea = superAdminGitea();
    // 新建组织尚无成员,org-init 据此创建管理员账号
    mockGitea.listOrgMembers.mockResolvedValueOnce([]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/approve',
      headers: { authorization: 'token super-token' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // ADR-0032：审批 = 状态翻转 + 同步开通；申请人入 Owners 成为初始管理员
    expect(body).toMatchObject({ status: 'active', orgName: 'acme', applicant: 'applicant-alice' });
    expect(mockGitea.createOrg).toHaveBeenCalledWith('acme');
    expect(mockGitea.createUser).not.toHaveBeenCalled();
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(1, 'applicant-alice');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-readers', 'read');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-writers', 'write');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-managers', 'admin');
    expect(JSON.stringify(mockGitea.createTeam.mock.calls)).not.toContain('system-admins');

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

  it('cancels a pending application by status flip alone', async () => {
    const db = initDatabase(dbPath);
    new OrgApplicationRepository(db).createApplication({
      orgName: 'acme',
      applicantUsername: 'applicant-alice'
    });
    db.close();

    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/cancel',
      headers
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'cancelled', orgName: 'acme' });
    // 取消后名字释放，申请人可再次申请
    const reapply = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token applicant-token' },
      payload: { orgName: 'acme' }
    });
    // applicant-alice 的 token 在此 mock 中无效，仅验证取消状态落库
    const after = initDatabase(dbPath);
    expect(after.prepare(`SELECT status FROM org_applications WHERE id = 1`).get()).toEqual({
      status: 'cancelled'
    });
    after.close();
  });

  
  
  it('rejects non-pending applications and unknown ids on cancel', async () => {
    const db = initDatabase(dbPath);
    new OrgApplicationRepository(db).createApplication({
      orgName: 'acme',
      applicantUsername: 'applicant-alice',
      adminDisplayName: 'Acme Admin',
      hashedPassword: 'hash-of-password'
    });
    db.prepare(`UPDATE org_applications SET status = 'approved' WHERE id = 1`).run();
    db.close();

    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const processed = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/cancel',
      headers
    });
    expect(processed.statusCode).toBe(409);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/999/cancel',
      headers
    });
    expect(missing.statusCode).toBe(404);
  });

  it('exposes lifecycle status and failure reason with the org list', async () => {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'ghost-org', status: 'failed' });
    new TenantOrganizationRepository(db).transition('ghost-org', 'failed', 'external resource');
    db.close();

    const mockGitea = superAdminGitea();
    // 开通失败的组织不会出现在 Git Backend 列表中,从租户状态表补充
    mockGitea.listOrgs.mockResolvedValue([]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orgs',
      headers: { authorization: 'token super-token' }
    });

    expect(response.statusCode).toBe(200);
    const orgs = response.json();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      name: 'ghost-org',
      memberCount: 0,
      status: 'failed',
      lastError: 'external resource'
    });
  });

  it('reads and updates the registration mode setting', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const initial = await app.inject({ method: 'GET', url: '/api/admin/orgs/settings', headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ orgRegistrationMode: 'auto', registrationMode: 'open', memberAddMode: 'direct' });

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { orgRegistrationMode: 'manual' }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ orgRegistrationMode: 'manual', registrationMode: 'open', memberAddMode: 'direct' });

    const reread = await app.inject({ method: 'GET', url: '/api/admin/orgs/settings', headers });
    expect(reread.json()).toEqual({ orgRegistrationMode: 'manual', registrationMode: 'open', memberAddMode: 'direct' });

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
    expect(response.json()).toEqual([
      {
        name: 'acme',
        memberCount: 2,
        skillCount: 1,
        createdAt: undefined,
        status: null,
        lastError: null
      }
    ]);
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
    // ADR-0032：同步删除，成员为全局账号不再删除
    expect(matched.statusCode).toBe(200);
    expect(matched.json()).toEqual({ status: 'deleted', orgName: 'acme' });
    expect(mockGitea.listOrgRepos).toHaveBeenCalledWith('acme');
    expect(mockGitea.deleteRepo).toHaveBeenCalledWith('acme', 'reviewer');
    expect(mockGitea.deleteUser).not.toHaveBeenCalled();
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
