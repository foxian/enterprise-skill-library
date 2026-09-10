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
      listTeamMembers: vi.fn().mockResolvedValue([]),
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
    expect(body.status).toBe('approved');
    expect(typeof body.initialPassword).toBe('string');
    expect(mockGitea.createOrg).toHaveBeenCalledWith('acme');
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_admin', body.initialPassword);
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(1, 'acme_admin');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-readers', 'read');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-writers', 'write');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-managers', 'admin');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'system-admins', 'admin', {
      includesAllRepositories: true,
      canCreateOrgRepo: true
    });
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(9, 'acme_admin');

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

  it('cancels a pending application, clears its credential, and writes audit records', async () => {
    const applicationEncryptionKey = 'a'.repeat(64);
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'pending' });
    new OrgApplicationRepository(db).createApplication({
      orgName: 'acme',
      adminDisplayName: 'Acme Admin',
      encryptedPassword: encryptApplicationSecret('applicant-password-123', applicationEncryptionKey)
    });
    db.close();

    const mockGitea = superAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });
    const headers = { authorization: 'token super-token' };

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/cancel',
      headers
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'cancelled', orgName: 'acme' });

    const after = initDatabase(dbPath);
    expect(after.prepare('SELECT status, encrypted_password FROM org_applications WHERE id = 1').get()).toEqual({
      status: 'cancelled',
      encrypted_password: null
    });
    expect(after.prepare(`SELECT status FROM tenant_organizations WHERE org_name = 'acme'`).get()).toEqual({
      status: 'cancelled'
    });
    const operation = after.prepare(`SELECT id FROM operations WHERE idempotency_key = 'organization.cancel:1'`).get() as {
      id: number;
    };
    expect(operation).toBeDefined();
    const audits = after.prepare('SELECT event, actor FROM operation_audits WHERE operation_id = ?').all(operation.id);
    expect(audits).toEqual([{ event: 'organization.cancel', actor: 'eslroot' }]);
    after.close();

    const repeat = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/cancel',
      headers
    });
    expect(repeat.statusCode).toBe(409);
  });

  it('rejects non-pending applications and unknown ids on cancel', async () => {
    const db = initDatabase(dbPath);
    new OrgApplicationRepository(db).createApplication({
      orgName: 'acme',
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

  it('exposes lifecycle status, failure reason, and operation id with the org list', async () => {
    const db = initDatabase(dbPath);
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'organization.provision:1',
      kind: 'organization.provision',
      payload: { orgName: 'acme' }
    });
    // 置为退避中的失败态,避免 buildApp 启动时的 processPending 认领重跑
    db.prepare(`
      UPDATE operations
      SET status = 'failed', next_retry_at = '2999-01-01T00:00:00.000Z'
      WHERE id = ?
    `).run(operation.id);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'failed', operationId: operation.id });
    new TenantOrganizationRepository(db).transition('acme', 'failed', {
      code: 'EXTERNAL_RESOURCE',
      message: 'Organization already exists with external owners (external-human)',
      details: { resources: ['owner external-human'] }
    });
    db.close();

    const mockGitea = superAdminGitea();
    // 开通在 Gitea 建组织之前失败:Git Backend 列表中没有该组织
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
      name: 'acme',
      memberCount: 0,
      status: 'failed',
      operationId: operation.id,
      lastError: { code: 'EXTERNAL_RESOURCE' }
    });
    expect(JSON.stringify(orgs)).not.toContain('applicant-password');
  });

  it('returns audit records for an operation to the platform administrator', async () => {
    const db = initDatabase(dbPath);
    new OrgApplicationRepository(db).createApplication({
      orgName: 'acme',
      adminDisplayName: 'Acme Admin',
      hashedPassword: 'hash-of-password'
    });
    db.close();

    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const reject = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/reject',
      headers
    });
    expect(reject.statusCode).toBe(200);

    const dbAfter = initDatabase(dbPath);
    const operation = dbAfter.prepare(`SELECT id FROM operations WHERE idempotency_key = 'organization.reject:1'`).get() as {
      id: number;
    };
    expect(operation).toBeDefined();
    dbAfter.close();

    const audits = await app.inject({
      method: 'GET',
      url: `/api/admin/operations/${operation.id}/audits`,
      headers
    });
    expect(audits.statusCode).toBe(200);
    expect(audits.json()).toEqual([
      expect.objectContaining({ event: 'organization.reject', actor: 'eslroot' })
    ]);

    const unauthorized = await app.inject({
      method: 'GET',
      url: `/api/admin/operations/${operation.id}/audits`,
      headers: { authorization: 'token member-token' }
    });
    expect(unauthorized.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/operations/999/audits',
      headers
    });
    expect(missing.statusCode).toBe(404);
  });

  it('reads and updates the registration mode setting', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const initial = await app.inject({ method: 'GET', url: '/api/admin/orgs/settings', headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ orgRegistrationMode: 'auto', deploymentMode: 'multi', defaultOrg: null });

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers,
      payload: { orgRegistrationMode: 'manual' }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ orgRegistrationMode: 'manual', deploymentMode: 'multi', defaultOrg: null });

    const reread = await app.inject({ method: 'GET', url: '/api/admin/orgs/settings', headers });
    expect(reread.json()).toEqual({ orgRegistrationMode: 'manual', deploymentMode: 'multi', defaultOrg: null });

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
        lastError: null,
        operationId: null
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

  it('creates an organization directly with auto-generated password', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey: 'a'.repeat(64)
    });
    const headers = { authorization: 'token super-token' };

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs',
      headers,
      payload: { orgName: 'neworg' }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ status: 'provisioning', orgName: 'neworg' });
    expect(body.operationId).toBeGreaterThan(0);
    expect(body.initialPassword).toBeTruthy();

    // 创建了 application 记录，标记为 system 发起（via org applications API，不直接打开 DB）
    const applications = await app.inject({
      method: 'GET',
      url: '/api/admin/orgs/applications',
      headers
    });
    expect(applications.statusCode).toBe(200);
    expect(applications.json()).toEqual([
      expect.objectContaining({ orgName: 'neworg', adminDisplayName: 'system', status: 'approved' })
    ]);

    // 组织列表能看到新组织（tenant 表补充，Gitea 列表不包含时）。
    // 测试环境下异步 Operation 同步执行完毕（mock Gitea 成功），状态为 active。
    const orgs = await app.inject({ method: 'GET', url: '/api/admin/orgs', headers });
    const neworgRow = (orgs.json() as Array<{ name: string; status: string | null }>).find(
      (row) => row.name === 'neworg'
    );
    expect(neworgRow).toMatchObject({ name: 'neworg', status: 'active' });
  });

  it('creates an organization with a custom password', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey: 'a'.repeat(64)
    });
    const headers = { authorization: 'token super-token' };

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs',
      headers,
      payload: { orgName: 'customorg', password: 'my-strong-password-123' }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ status: 'provisioning', orgName: 'customorg' });
    expect(body.initialPassword).toBe('my-strong-password-123');
  });

  it('rejects invalid organization names and weak passwords with 400', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey: 'a'.repeat(64)
    });
    const headers = { authorization: 'token super-token' };

    const badName = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs',
      headers,
      payload: { orgName: 'UPPER-CASE' }
    });
    expect(badName.statusCode).toBe(400);

    const badPassword = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs',
      headers,
      payload: { orgName: 'valid-org', password: 'short' }
    });
    expect(badPassword.statusCode).toBe(400);
  });

  it('returns 409 when the organization already exists', async () => {
    const mockGitea = superAdminGitea();
    mockGitea.organizationExists.mockResolvedValue(true);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey: 'a'.repeat(64)
    });
    const headers = { authorization: 'token super-token' };

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs',
      headers,
      payload: { orgName: 'taken-org' }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Organization name is already taken' });
  });

  it('returns 409 when the tenant already exists in the platform database', async () => {
    const seed = initDatabase(dbPath);
    new TenantOrganizationRepository(seed).create({ orgName: 'existing', status: 'active' });
    seed.close();

    const mockGitea = superAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey: 'a'.repeat(64)
    });
    const headers = { authorization: 'token super-token' };

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs',
      headers,
      payload: { orgName: 'existing' }
    });
    expect(response.statusCode).toBe(409);
  });

  it('returns 503 when the application encryption key is not configured', async () => {
    const mockGitea = superAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token super-token' };

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs',
      headers,
      payload: { orgName: 'no-key-org' }
    });
    expect(response.statusCode).toBe(503);
  });
});
