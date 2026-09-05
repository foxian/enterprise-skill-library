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
  TenantOrganizationRepository
} from '../src/db/database.js';
import { encryptApplicationSecret } from '../src/services/application-secret.js';

describe('organization application lifecycle', () => {
  const applicationEncryptionKey = 'a'.repeat(64);
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-apply-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function autoModeGitea() {
    return {
      organizationExists: vi.fn().mockResolvedValue(false),
      createOrg: vi.fn().mockResolvedValue(undefined),
      createUser: vi.fn().mockResolvedValue(undefined),
      listOrgMembers: vi.fn().mockResolvedValue([]),
      listTeams: vi
        .fn()
        .mockResolvedValue([{ id: 1, name: 'Owners', permission: 'owner' }]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      createTeam: vi.fn().mockResolvedValue({ id: 9, name: 'team', permission: 'read' })
    };
  }

  it('initializes the Gitea organization immediately in auto mode', async () => {
    const mockGitea = autoModeGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: {
        orgName: 'acme',
        adminDisplayName: 'Acme Admin',
        password: 'initial-password'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('provisioning');
    expect(typeof response.json().operationId).toBe('number');
    expect(mockGitea.createOrg).toHaveBeenCalledWith('acme');
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_admin', 'initial-password');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(1, 'acme_admin');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-readers', 'read');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-writers', 'write');
  });

  it('stores a pending application and returns its id in manual mode', async () => {
    const settingsDb = initDatabase(dbPath);
    new PlatformSettingsRepository(settingsDb).setSetting('org_registration_mode', 'manual');
    settingsDb.close();

    const mockGitea = autoModeGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: {
        orgName: 'acme',
        adminDisplayName: 'Acme Admin',
        password: 'initial-password'
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('pending');
    expect(typeof body.applicationId).toBe('number');
    expect(mockGitea.createOrg).not.toHaveBeenCalled();
    expect(mockGitea.createUser).not.toHaveBeenCalled();
  });

  it('rejects invalid organization names before touching Gitea', async () => {
    const mockGitea = autoModeGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    for (const orgName of ['acme_corp', 'Acme', 'a', '-acme', 'acme-', 'admin', 'a'.repeat(40)]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orgs/apply',
        body: { orgName, adminDisplayName: 'Admin', password: 'initial-password' }
      });
      expect(response.statusCode).toBe(400);
    }
    expect(mockGitea.createOrg).not.toHaveBeenCalled();
  });

  it('rejects an application when the organization name is already taken', async () => {
    const mockGitea = autoModeGitea();
    mockGitea.organizationExists.mockResolvedValue(true);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });

    expect(response.statusCode).toBe(409);
    expect(mockGitea.createOrg).not.toHaveBeenCalled();
  });

  it('rejects a duplicate application for the same organization in manual mode', async () => {
    const settingsDb = initDatabase(dbPath);
    new PlatformSettingsRepository(settingsDb).setSetting('org_registration_mode', 'manual');
    settingsDb.close();

    const mockGitea = autoModeGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });
    expect(second.statusCode).toBe(409);
  });

  it('records initialization failure after the auto-mode request is accepted', async () => {
    const mockGitea = autoModeGitea();
    mockGitea.createUser.mockRejectedValue(new Error('password too short'));
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('provisioning');
    await new Promise((resolve) => setImmediate(resolve));
    const db = initDatabase(dbPath);
    expect(db.prepare('SELECT status FROM tenant_organizations WHERE org_name = ?').get('acme')).toEqual({
      status: 'failed'
    });
    db.close();
  });

  it('can retry provisioning without recreating resources that already exist', async () => {
    const mockGitea = autoModeGitea();
    mockGitea.createTeam
      .mockResolvedValueOnce({ id: 2, name: 'all-readers', permission: 'read' })
      .mockRejectedValueOnce(new Error('temporary failure'));
    mockGitea.organizationExists.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    mockGitea.listOrgMembers.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' }
    ]);
    mockGitea.listTeams.mockResolvedValueOnce([{ id: 1, name: 'Owners', permission: 'owner' }]).mockResolvedValue([
      { id: 1, name: 'Owners', permission: 'owner' },
      { id: 2, name: 'all-readers', permission: 'read' },
      { id: 3, name: 'all-writers', permission: 'write' }
    ]);
    // 重试时组织已存在,需要校验 Owners 归属(只包含本组织管理员)
    mockGitea.listTeamMembers.mockResolvedValue([
      { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' }
    ]);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });
    expect(response.statusCode).toBe(201);
    await new Promise((resolve) => setImmediate(resolve));

    const db = initDatabase(dbPath);
    db.prepare(`UPDATE operations SET next_retry_at = NULL, status = 'failed' WHERE kind = 'organization.provision'`).run();
    db.close();
    await app.close();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockGitea.createOrg).toHaveBeenCalledTimes(1);
    expect(mockGitea.createUser).toHaveBeenCalledTimes(1);
    expect(mockGitea.createTeam).toHaveBeenCalledTimes(2);
    const after = initDatabase(dbPath);
    expect(after.prepare(`SELECT status FROM operations WHERE kind = 'organization.provision'`).get()).toMatchObject({
      status: 'succeeded'
    });
    expect(after.prepare(`SELECT status FROM tenant_organizations WHERE org_name = 'acme'`).get()).toEqual({
      status: 'active'
    });
    after.close();
  });

  it('removes the platform site admin from the Owners team after initialization', async () => {
    const mockGitea = {
      ...autoModeGitea(),
      adminUsername: 'eslroot',
      removeTeamMember: vi.fn().mockResolvedValue(undefined)
    };
    // Gitea 创建组织时会把 admin token 持有者(site admin)自动加入 Owners 团队
    mockGitea.listTeamMembers.mockResolvedValue([
      { id: 2, username: 'eslroot', email: 'eslroot@local.esl' },
      { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' }
    ]);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', password: 'initial-password' }
    });
    expect(response.statusCode).toBe(201);
    await new Promise((resolve) => setImmediate(resolve));

    // 初始化完成后 Owners 团队只保留本组织管理员
    expect(mockGitea.removeTeamMember).toHaveBeenCalledWith(1, 'eslroot');
    const after = initDatabase(dbPath);
    expect(after.prepare(`SELECT status FROM tenant_organizations WHERE org_name = 'acme'`).get()).toEqual({
      status: 'active'
    });
    after.close();
  });

  it('allows retrying provisioning when the Owners team contains the platform site admin', async () => {
    const mockGitea = {
      ...autoModeGitea(),
      adminUsername: 'eslroot',
      removeTeamMember: vi.fn().mockResolvedValue(undefined)
    };
    // 首次开通:建组织成功(Gitea 自动把 site admin 加入 Owners)、创建管理员失败;
    // 重试时组织已存在,Owners 同时含 site admin 与本组织管理员。
    mockGitea.createUser.mockRejectedValueOnce(new Error('temporary failure'));
    mockGitea.organizationExists.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    mockGitea.listOrgMembers.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' }
    ]);
    mockGitea.listTeams.mockResolvedValueOnce([{ id: 1, name: 'Owners', permission: 'owner' }]).mockResolvedValue([
      { id: 1, name: 'Owners', permission: 'owner' },
      { id: 2, name: 'all-readers', permission: 'read' },
      { id: 3, name: 'all-writers', permission: 'write' }
    ]);
    mockGitea.listTeamMembers.mockResolvedValue([
      { id: 2, username: 'eslroot', email: 'eslroot@local.esl' },
      { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' }
    ]);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', password: 'initial-password' }
    });
    expect(response.statusCode).toBe(201);
    await new Promise((resolve) => setImmediate(resolve));

    const db = initDatabase(dbPath);
    db.prepare(`UPDATE operations SET next_retry_at = NULL, status = 'failed' WHERE kind = 'organization.provision'`).run();
    db.close();
    await app.close();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });
    await new Promise((resolve) => setImmediate(resolve));

    // site admin 常驻 Owners 不构成外部所有者:重试应完成开通而不是拒绝接管
    const after = initDatabase(dbPath);
    expect(after.prepare(`SELECT status FROM operations WHERE kind = 'organization.provision'`).get()).toMatchObject({
      status: 'succeeded'
    });
    expect(after.prepare(`SELECT status FROM tenant_organizations WHERE org_name = 'acme'`).get()).toEqual({
      status: 'active'
    });
    after.close();
  });

  it('lets applicants query their own application status without exposing credentials', async () => {
    const settingsDb = initDatabase(dbPath);
    new PlatformSettingsRepository(settingsDb).setSetting('org_registration_mode', 'manual');
    settingsDb.close();

    const mockGitea = autoModeGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const apply = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });
    expect(apply.statusCode).toBe(201);

    // 申请密文仍存在,查询必须证明申请人身份
    const missingPassword = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications/acme/status',
      payload: {}
    });
    expect(missingPassword.statusCode).toBe(401);

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications/acme/status',
      payload: { password: 'wrong-password' }
    });
    expect(wrongPassword.statusCode).toBe(403);

    const status = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications/acme/status',
      payload: { password: 'initial-password' }
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ orgName: 'acme', status: 'pending' });
    expect(JSON.stringify(status.json())).not.toContain('initial-password');

    const missing = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications/ghost/status',
      payload: {}
    });
    expect(missing.statusCode).toBe(404);
  });

  it('transitions a failed organization back to provisioning when provisioning is retried', async () => {
    const mockGitea = {
      ...autoModeGitea(),
      validateAdminUserToken: vi.fn(async (token: string) =>
        token === 'super-token' ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
      )
    };
    let releaseWritersTeam: () => void = () => {};
    const hangingWritersTeam = new Promise<void>((resolve) => {
      releaseWritersTeam = resolve;
    });
    // 首次尝试:all-readers 成功、all-writers 失败;重试:重建 all-readers 后停在 all-writers
    mockGitea.createTeam
      .mockResolvedValueOnce({ id: 2, name: 'all-readers', permission: 'read' })
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ id: 2, name: 'all-readers', permission: 'read' })
      .mockReturnValueOnce(hangingWritersTeam as any);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const apply = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', password: 'initial-password' }
    });
    expect(apply.statusCode).toBe(201);
    await new Promise((resolve) => setImmediate(resolve));

    const db = initDatabase(dbPath);
    const operationId = (db.prepare(`SELECT id FROM operations WHERE kind = 'organization.provision'`).get() as { id: number }).id;
    db.close();
    const retry = await app.inject({
      method: 'POST',
      url: `/api/admin/operations/${operationId}/retry`,
      headers: { authorization: 'token super-token' }
    });
    expect(retry.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 重试仅允许 failed -> provisioning(ADR-0017),开通完成后再进入 active
    const during = initDatabase(dbPath);
    expect(during.prepare(`SELECT status FROM tenant_organizations WHERE org_name = 'acme'`).get()).toEqual({
      status: 'provisioning'
    });
    during.close();

    releaseWritersTeam();
    await new Promise((resolve) => setImmediate(resolve));
    const after = initDatabase(dbPath);
    expect(after.prepare(`SELECT status FROM tenant_organizations WHERE org_name = 'acme'`).get()).toEqual({
      status: 'active'
    });
    after.close();
  });

  it('requires orgName and password', async () => {
    const mockGitea = autoModeGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.createOrg).not.toHaveBeenCalled();

    // adminDisplayName 无业务用途:不再要求,管理员身份固定为 admin
    const withoutDisplayName = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', password: 'initial-password' }
    });
    expect(withoutDisplayName.statusCode).toBe(201);
  });

  it('refuses to take over an externally owned organization', async () => {
    const mockGitea = autoModeGitea();
    // 申请校验时组织不存在,执行器运行前组织已被外部创建且 Owners 含外部成员
    mockGitea.organizationExists.mockResolvedValueOnce(false).mockResolvedValue(true);
    mockGitea.listTeams.mockResolvedValue([{ id: 1, name: 'Owners', permission: 'owner' }]);
    mockGitea.listTeamMembers.mockResolvedValue([
      { id: 5, username: 'external-human', email: 'external-human@local.esl' }
    ]);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });
    expect(response.statusCode).toBe(201);
    await new Promise((resolve) => setImmediate(resolve));

    // 不向外部组织写入任何资源,失败原因可查询
    expect(mockGitea.createUser).not.toHaveBeenCalled();
    expect(mockGitea.addTeamMember).not.toHaveBeenCalled();
    expect(mockGitea.createTeam).not.toHaveBeenCalled();
    const db = initDatabase(dbPath);
    const tenant = db.prepare('SELECT status, last_error_json FROM tenant_organizations WHERE org_name = ?').get('acme') as {
      status: string;
      last_error_json: string;
    };
    expect(tenant.status).toBe('failed');
    const failure = JSON.parse(tenant.last_error_json);
    expect(failure.code).toBe('EXTERNAL_RESOURCE');
    expect(failure.details.resources).toContain('owner external-human');
    db.close();
  });

  it('expires pending applications after 30 days and clears the stored credential', async () => {
    const settingsDb = initDatabase(dbPath);
    new PlatformSettingsRepository(settingsDb).setSetting('org_registration_mode', 'manual');
    settingsDb.close();

    const seedDb = initDatabase(dbPath);
    const applications = new OrgApplicationRepository(seedDb);
    const stale = applications.createApplication({
      orgName: 'old-org',
      adminDisplayName: 'Old Admin',
      encryptedPassword: encryptApplicationSecret('stale-password', applicationEncryptionKey)
    });
    seedDb.prepare(`UPDATE org_applications SET created_at = datetime('now', '-31 days') WHERE id = ?`).run(stale.id);
    new TenantOrganizationRepository(seedDb).create({ orgName: 'old-org', status: 'pending' });
    applications.createApplication({
      orgName: 'fresh-org',
      adminDisplayName: 'Fresh Admin',
      encryptedPassword: encryptApplicationSecret('fresh-password', applicationEncryptionKey)
    });
    new TenantOrganizationRepository(seedDb).create({ orgName: 'fresh-org', status: 'pending' });
    seedDb.close();

    app = await buildApp({
      dbPath,
      giteaService: {
        ...autoModeGitea(),
        validateAdminUserToken: vi.fn(async (token: string) =>
          token === 'super-token' ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
        )
      } as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const db = initDatabase(dbPath);
    const expired = db.prepare('SELECT status, encrypted_password FROM org_applications WHERE org_name = ?').get('old-org') as {
      status: string;
      encrypted_password: string | null;
    };
    expect(expired).toEqual({ status: 'expired', encrypted_password: null });
    expect(db.prepare(`SELECT status FROM tenant_organizations WHERE org_name = 'old-org'`).get()).toEqual({
      status: 'expired'
    });
    // 过期状态变更写入可查询审计记录
    const audit = db.prepare(`
      SELECT a.event, a.details_json
      FROM operation_audits a
      JOIN operations o ON o.id = a.operation_id
      WHERE o.kind = 'organization.expire'
    `).get() as { event: string; details_json: string };
    expect(audit.event).toBe('organization.expire');
    expect(JSON.parse(audit.details_json)).toEqual({ orgName: 'old-org' });
    // 新申请不受影响
    expect(db.prepare('SELECT status FROM org_applications WHERE org_name = ?').get('fresh-org')).toMatchObject({
      status: 'pending'
    });
    db.close();

    // 过期申请不可再审批
    const approve = await app.inject({
      method: 'POST',
      url: `/api/admin/orgs/applications/${stale.id}/approve`,
      headers: { authorization: 'token super-token' }
    });
    expect(approve.statusCode).toBe(409);
  });
});
