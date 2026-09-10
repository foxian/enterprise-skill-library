import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository } from '../src/db/database.js';

describe('organization console API', () => {
  const applicationEncryptionKey = 'a'.repeat(64);
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  const defaultTeams = [
    { id: 1, name: 'Owners', permission: 'owner' },
    { id: 2, name: 'all-readers', permission: 'read' },
    { id: 3, name: 'all-writers', permission: 'write' },
    { id: 7, name: 'frontend', permission: 'read' }
  ];

  function orgAdminGitea() {
    return {
      validateToken: vi.fn(async (token: string) => {
        if (token === 'acme-admin-token') return { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' };
        if (token === 'other-admin-token') return { id: 2, username: 'other_admin', email: 'other_admin@local.esl' };
        return null;
      }),
      organizationExists: vi.fn().mockResolvedValue(true),
      listOrgMembers: vi
        .fn()
        .mockResolvedValue([{ id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }]),
      createUser: vi.fn().mockResolvedValue(undefined),
      disableUser: vi.fn().mockResolvedValue(undefined),
      enableUser: vi.fn().mockResolvedValue(undefined),
      changeUserPassword: vi.fn().mockResolvedValue(undefined),
      listTeams: vi.fn().mockResolvedValue(defaultTeams),
      listTeamMembers: vi
        .fn()
        .mockResolvedValue([{ id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }]),
      createTeam: vi.fn().mockResolvedValue({ id: 9, name: 'frontend', permission: 'read' }),
      updateTeam: vi.fn().mockResolvedValue({ id: 7, name: 'frontend', permission: 'read' }),
      deleteTeam: vi.fn().mockResolvedValue(undefined),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      removeTeamMember: vi.fn().mockResolvedValue(undefined),
      removeOrgMember: vi.fn().mockResolvedValue(undefined)
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-console-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects callers that are not an organization admin account', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const routes: Array<{ method: string; url: string }> = [
      { method: 'GET', url: '/api/orgs/members' },
      { method: 'POST', url: '/api/orgs/members' },
      { method: 'POST', url: '/api/orgs/members/bob/disable' },
      { method: 'POST', url: '/api/orgs/members/bob/password' },
      { method: 'GET', url: '/api/orgs/teams' },
      { method: 'POST', url: '/api/orgs/teams' },
      { method: 'DELETE', url: '/api/orgs/teams/7' },
      { method: 'POST', url: '/api/orgs/teams/7/members' },
      { method: 'DELETE', url: '/api/orgs/teams/7/members/bob' }
    ];
    for (const route of routes) {
      const response = await app.inject({
        method: route.method as any,
        url: route.url,
        headers: { authorization: 'token member-token' },
        payload: { username: 'bob', password: 'password-123', name: 'frontend', permission: 'read' }
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('admits system management team members to the organization console', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.validateToken = vi.fn(async (token: string) => {
      if (token === 'acme-admin-token') return { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' };
      if (token === 'system-admin-token') return { id: 4, username: 'acme_alice', email: 'acme_alice@local.esl' };
      if (token === 'member-token') return { id: 5, username: 'acme_bob', email: 'acme_bob@local.esl' };
      return null;
    });
    mockGitea.listTeams = vi
      .fn()
      .mockResolvedValue([...defaultTeams, { id: 5, name: 'system-admins', permission: 'admin' }]);
    mockGitea.isTeamMember = vi.fn(
      async (teamId: number, username: string) => teamId === 5 && username === 'acme_alice'
    );
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const systemAdmin = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams',
      headers: { authorization: 'token system-admin-token' }
    });
    expect(systemAdmin.statusCode).toBe(200);

    const member = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams',
      headers: { authorization: 'token member-token' }
    });
    expect(member.statusCode).toBe(403);
  });

  it('refuses to remove the organization administrator from the Owners team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/1/members/admin',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.removeTeamMember).not.toHaveBeenCalled();
  });

  it('allows removing the organization administrator from a non-Owners team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/7/members/admin',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(mockGitea.removeTeamMember).toHaveBeenCalledWith(7, 'acme_admin');
  });

  it('protects the admin account in the system admins team while other members can leave', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.listTeams = vi.fn().mockResolvedValue([
      ...defaultTeams,
      { id: 5, name: 'system-admins', permission: 'admin' }
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const adminRemoval = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/5/members/admin',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(adminRemoval.statusCode).toBe(400);
    expect(mockGitea.removeTeamMember).not.toHaveBeenCalled();

    const memberRemoval = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/5/members/bob',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(memberRemoval.statusCode).toBe(200);
    expect(mockGitea.removeTeamMember).toHaveBeenCalledWith(5, 'acme_bob');
  });

  it('lists disabled members of the organization', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.listUsers = vi.fn().mockResolvedValue([
      // 禁用是 prohibit_login=true;active 恒为 true(激活态),不能作为禁用判据
      { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl', active: true, prohibit_login: false },
      { id: 2, username: 'acme_zed', email: 'acme_zed@local.esl', active: true, prohibit_login: true },
      { id: 3, username: 'other_bob', email: 'other_bob@local.esl', active: true, prohibit_login: true }
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/members/disabled',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    // 只返回本组织(acme_)前缀且被禁用的用户
    expect(response.json()).toEqual([{ id: 2, username: 'acme_zed', email: 'acme_zed@local.esl' }]);
    expect(mockGitea.listUsers).toHaveBeenCalledWith('acme_');
  });

  it('refuses to disable the organization administrator account', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members/admin/disable',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.disableUser).not.toHaveBeenCalled();
  });

  it('rejects an administrator whose organization does not exist', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.organizationExists.mockResolvedValue(false);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(403);
  });

  it('lists the members of the administrator organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }]);
    expect(mockGitea.listOrgMembers).toHaveBeenCalledWith('acme');
  });

  it('submits member creation as a recoverable operation', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob', password: 'initial-password' }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: 'pending',
      username: 'acme_bob',
      operationId: expect.any(Number)
    });
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_bob', 'initial-password');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(2, 'acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(3, 'acme_bob');
  });

  it('returns the existing member creation operation for a repeated request', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const request = {
      method: 'POST' as const,
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob', password: 'initial-password' }
    };
    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().operationId).toBe(first.json().operationId);
    expect(mockGitea.createUser).toHaveBeenCalledTimes(1);
  });

  it('generates an initial password when adding a member without one', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob' }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe('pending');
    expect(typeof body.operationId).toBe('number');
    expect(body.username).toBe('acme_bob');
    expect(typeof body.password).toBe('string');
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_bob', body.password);
  });

  it('retries a failed member creation after restart without storing its password in the operation payload', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.createUser.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue(undefined);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob', password: 'initial-password' }
    });

    expect(response.statusCode).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    const operationId = response.json().operationId;
    const db = initDatabase(dbPath);
    expect(db.prepare('SELECT payload_json FROM operations WHERE id = ?').get(operationId)).toEqual({
      payload_json: '{"orgName":"acme","username":"acme_bob"}'
    });
    expect(db.prepare('SELECT encrypted_secret FROM operation_secrets WHERE operation_id = ?').get(operationId)).not.toEqual(
      expect.objectContaining({ encrypted_secret: expect.stringContaining('initial-password') })
    );
    db.prepare(`UPDATE operations SET next_retry_at = NULL, status = 'failed' WHERE id = ?`).run(operationId);
    db.close();

    await app.close();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockGitea.createUser).toHaveBeenCalledTimes(2);
    expect(mockGitea.createUser).toHaveBeenLastCalledWith('acme_bob', 'initial-password');
    const completedDb = initDatabase(dbPath);
    expect(completedDb.prepare('SELECT encrypted_secret FROM operation_secrets WHERE operation_id = ?').get(operationId)).toBeUndefined();
    completedDb.close();
  });

  it('disables a member by removing them from all teams and the organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members/bob/disable',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: 'pending',
      username: 'acme_bob',
      operationId: expect.any(Number)
    });
    expect(mockGitea.disableUser).toHaveBeenCalledWith('acme_bob');
    for (const team of defaultTeams) {
      expect(mockGitea.removeTeamMember).toHaveBeenCalledWith(team.id, 'acme_bob');
    }
    expect(mockGitea.removeOrgMember).toHaveBeenCalledWith('acme', 'acme_bob');
  });

  it('converges repeated disable requests carrying the same idempotency key', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const request = {
      method: 'POST' as const,
      url: '/api/orgs/members/bob/disable',
      headers: { authorization: 'token acme-admin-token', 'idempotency-key': 'retry-1' }
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().operationId).toBe(first.json().operationId);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockGitea.disableUser).toHaveBeenCalledTimes(1);
    expect(mockGitea.removeOrgMember).toHaveBeenCalledTimes(1);
  });

  it('recovers a member creation whose default team join failed mid-way', async () => {
    const mockGitea = orgAdminGitea();
    // 用户创建成功、加入 all-readers 成功、加入 all-writers 失败
    mockGitea.addTeamMember
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(undefined);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob', password: 'initial-password' }
    });
    expect(response.statusCode).toBe(202);
    const operationId = response.json().operationId;
    await new Promise((resolve) => setImmediate(resolve));

    const db = initDatabase(dbPath);
    expect(db.prepare('SELECT status FROM operations WHERE id = ?').get(operationId)).toMatchObject({
      status: 'failed'
    });
    // 失败不静默:operation 携带失败原因
    const failed = db.prepare('SELECT error_json FROM operations WHERE id = ?').get(operationId) as {
      error_json: string;
    };
    expect(JSON.parse(failed.error_json).message).toContain('temporary failure');
    db.prepare(`UPDATE operations SET next_retry_at = NULL WHERE id = ?`).run(operationId);
    db.close();

    // 服务重启后 processPending 认领并收敛
    await app.close();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });
    await new Promise((resolve) => setImmediate(resolve));

    // 重试复用已创建用户并补齐缺失团队关系
    expect(mockGitea.addTeamMember).toHaveBeenCalledTimes(4);
    expect(mockGitea.addTeamMember).toHaveBeenNthCalledWith(3, 2, 'acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenNthCalledWith(4, 3, 'acme_bob');
    const after = initDatabase(dbPath);
    expect(after.prepare('SELECT status FROM operations WHERE id = ?').get(operationId)).toMatchObject({
      status: 'succeeded'
    });
    after.close();
  });

  it('enrolls a new member into the three all-member default teams', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.listTeams = vi.fn().mockResolvedValue([
      ...defaultTeams,
      { id: 4, name: 'all-managers', permission: 'admin' },
      { id: 5, name: 'system-admins', permission: 'admin' }
    ]);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob', password: 'initial-password' }
    });
    expect(response.statusCode).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(2, 'acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(3, 'acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(4, 'acme_bob');
    // system-admins 不自动加入,由持有组织管理权者手动增删(ADR-0026)
    expect(mockGitea.addTeamMember).not.toHaveBeenCalledWith(5, 'acme_bob');
  });

  it('re-enables a member into the three all-member teams only', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.listTeams = vi.fn().mockResolvedValue([
      ...defaultTeams,
      { id: 4, name: 'all-managers', permission: 'admin' },
      { id: 5, name: 'system-admins', permission: 'admin' }
    ]);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members/bob/enable',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(response.statusCode).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(2, 'acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(3, 'acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(4, 'acme_bob');
    // 敏感授权不自动恢复:禁用清出 system-admins 后,启用不回该团队
    expect(mockGitea.addTeamMember).not.toHaveBeenCalledWith(5, 'acme_bob');
  });

  it('rejects a member password reset below the shared policy minimum', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members/bob/password',
      headers: { authorization: 'token acme-admin-token' },
      payload: { password: 'short' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.changeUserPassword).not.toHaveBeenCalled();
  });

  it('resets a member password', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members/bob/password',
      headers: { authorization: 'token acme-admin-token' },
      payload: { password: 'reset-password' }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: 'pending',
      username: 'acme_bob',
      operationId: expect.any(Number)
    });
    expect(mockGitea.changeUserPassword).toHaveBeenCalledWith('acme_bob', 'reset-password');
  });

  it('lists only the manageable teams: hides Owners and the three full-member default teams', async () => {
    const mockGitea = orgAdminGitea();
    // 组织含四个默认团队 + Owners + 自定义团队:仅 system-admins 与自定义团队可见
    mockGitea.listTeams = vi.fn().mockResolvedValue([
      { id: 1, name: 'Owners', permission: 'owner' },
      { id: 2, name: 'all-readers', permission: 'read' },
      { id: 3, name: 'all-writers', permission: 'write' },
      { id: 4, name: 'all-managers', permission: 'admin' },
      { id: 5, name: 'system-admins', permission: 'admin' },
      { id: 7, name: 'frontend', permission: 'read' }
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    // Owners 团队不属于团队管理界面(ADR-0026);三个全员团队由组织共享级别
    // 承载、成员自动同步,同样不展示。仅剩系统管理团队与自定义团队。
    // system-admins 的显示名由读时惰性播种补齐(ADR-0029),自定义团队无显示名。
    expect(response.json()).toEqual([
      { id: 5, name: 'system-admins', permission: 'manage', display_name: '系统管理团队' },
      { id: 7, name: 'frontend', permission: 'read' }
    ]);
  });

  it('creates a custom team with a permission level', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'backend', permission: 'write' }
    });

    expect(response.statusCode).toBe(201);
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'backend', 'write');
  });

  it('rejects an invalid permission level when creating a team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'backend', permission: 'root' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.createTeam).not.toHaveBeenCalled();
  });

  // SC-G2 (ADR-0025):ESL 的 manage 档映射为 Gitea admin 级团队
  it('creates a manage-level team by mapping to the Gitea admin level', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'ops', permission: 'manage' }
    });

    expect(response.statusCode).toBe(201);
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'ops', 'admin');
  });

  it('reports admin-level teams as manage in the team list', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.listTeams.mockResolvedValue([
      ...defaultTeams,
      { id: 8, name: 'ops', permission: 'admin' }
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toContainEqual({ id: 8, name: 'ops', permission: 'manage' });
  });

  it('refuses to delete the default teams', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    for (const teamId of [2, 3]) {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/orgs/teams/${teamId}`,
        headers: { authorization: 'token acme-admin-token' }
      });
      expect(response.statusCode).toBe(400);
    }
    expect(mockGitea.deleteTeam).not.toHaveBeenCalled();
  });

  it('refuses to delete the Owners team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/1',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.deleteTeam).not.toHaveBeenCalled();
  });

  it('refuses to delete the all-managers and system-admins default teams', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.listTeams = vi.fn().mockResolvedValue([
      ...defaultTeams,
      { id: 4, name: 'all-managers', permission: 'admin' },
      { id: 5, name: 'system-admins', permission: 'admin' }
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    for (const teamId of [4, 5]) {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/orgs/teams/${teamId}`,
        headers: { authorization: 'token acme-admin-token' }
      });
      expect(response.statusCode).toBe(400);
    }
    expect(mockGitea.deleteTeam).not.toHaveBeenCalled();
  });

  it('deletes a custom team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });
    expect(mockGitea.deleteTeam).toHaveBeenCalledWith(7);
  });

  it('deletes a custom team and cleans up its display name profile', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.createTeam = vi
      .fn()
      .mockResolvedValue({ id: 9, name: 'backend', permission: 'write' });
    mockGitea.listTeams = vi.fn().mockResolvedValue([
      ...defaultTeams,
      { id: 9, name: 'backend', permission: 'write' }
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'backend', permission: 'write', display_name: '后端团队' }
    });
    expect(created.json()).toMatchObject({ display_name: '后端团队' });

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/9',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(del.statusCode).toBe(200);
    expect(mockGitea.deleteTeam).toHaveBeenCalledWith(9);

    // ADR-0029:删除团队后清理其显示名记录——mock listTeams 是静态的,团队仍在
    // 列表里,但显示名已清空,恰好暴露 deleteTeamProfile 的落库清理效果。
    const listed = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' }
    });
    const backend = (listed.json() as Array<{ name: string; display_name?: string }>).find(
      (team) => team.name === 'backend'
    );
    expect(backend).toBeDefined();
    expect(backend!.display_name).toBeUndefined();
  });

  it('counts the skills a team is granted on for the permission-change warning', async () => {
    const mockGitea = orgAdminGitea();
    // 团队 7 挂载 2 个 acme 技能仓库 + 1 个非技能仓库;另一个 acme 技能未挂载
    mockGitea.listTeamRepos = vi.fn().mockResolvedValue([
      { id: 10, name: 'acme_reviewer', full_name: 'acme/acme_reviewer' },
      { id: 11, name: 'acme_prompts', full_name: 'acme/acme_prompts' },
      { id: 99, name: 'not-a-skill', full_name: 'acme/not-a-skill' }
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const db = initDatabase(dbPath);
    const seedSkill = (skillName: string) =>
      new SkillRepository(db).createSkill({
        name: `@acme/${skillName}`,
        scope: 'acme',
        skillName,
        description: 'd',
        createdBy: 'acme_alice',
        owner: 'acme_alice',
        maintainers: ['acme_alice'],
        visibility: 'private',
        gitRepoPath: `acme/acme_${skillName}`
      });
    seedSkill('reviewer');
    seedSkill('prompts');
    seedSkill('not-mounted');
    db.close();

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams/7/skills-count',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    // 挂载的 2 个 acme 技能计入,非技能仓库与未挂载技能不计入
    expect(response.json()).toEqual({ teamId: 7, skillsCount: 2 });
    expect(mockGitea.listTeamRepos).toHaveBeenCalledWith(7);
  });

  it('rejects skills-count for a team outside the administrator organization', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.listTeamRepos = vi.fn();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams/999/skills-count',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(403);
    expect(mockGitea.listTeamRepos).not.toHaveBeenCalled();
  });

  it('renames a custom team by its id', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.updateTeam = vi
      .fn()
      .mockResolvedValue({ id: 7, name: 'platform-frontend', permission: 'read' });
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'platform-frontend' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 7, name: 'platform-frontend', permission: 'read' });
    expect(mockGitea.updateTeam).toHaveBeenCalledWith(7, { name: 'platform-frontend' });
  });

  it('edits a custom team permission by mapping manage to the Gitea admin level', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.updateTeam = vi
      .fn()
      .mockResolvedValue({ id: 7, name: 'frontend', permission: 'admin' });
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' },
      payload: { permission: 'manage' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 7, name: 'frontend', permission: 'manage' });
    expect(mockGitea.updateTeam).toHaveBeenCalledWith(7, { permission: 'admin' });
  });

  it('rejects an invalid permission level when editing a team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' },
      payload: { permission: 'root' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.updateTeam).not.toHaveBeenCalled();
  });

  it('sets a team display name on create', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.createTeam = vi
      .fn()
      .mockResolvedValue({ id: 9, name: 'backend', permission: 'write' });
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'backend', permission: 'write', display_name: '后端团队' }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'backend', display_name: '后端团队' });
    // 显示名只落 ESL DB,不传 Gitea
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'backend', 'write');
  });

  it('edits only the display name without calling Gitea', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' },
      payload: { display_name: '前端团队' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 7, name: 'frontend', display_name: '前端团队' });
    expect(mockGitea.updateTeam).not.toHaveBeenCalled();
  });

  it('clears a team display name by sending an empty string', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const set = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' },
      payload: { display_name: '前端团队' }
    });
    expect(set.json()).toMatchObject({ display_name: '前端团队' });

    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' },
      payload: { display_name: '' }
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().display_name).toBeUndefined();

    // JSON null 同样表示清空,而非字面字符串 "null"
    const nulled = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' },
      payload: { display_name: null }
    });
    expect(nulled.json().display_name).toBeUndefined();
  });

  it('refuses to edit the default teams and rejects invalid names', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.updateTeam = vi.fn().mockResolvedValue({ id: 7, name: 'x', permission: 'read' });
    mockGitea.listTeams = vi.fn().mockResolvedValue([
      ...defaultTeams,
      { id: 4, name: 'all-managers', permission: 'admin' },
      { id: 5, name: 'system-admins', permission: 'admin' }
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    for (const teamId of [2, 3, 4, 5]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/orgs/teams/${teamId}`,
        headers: { authorization: 'token acme-admin-token' },
        payload: { name: 'renamed-team' }
      });
      expect(response.statusCode).toBe(400);
    }

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'Invalid Name!' }
    });
    expect(invalid.statusCode).toBe(400);
    expect(mockGitea.updateTeam).not.toHaveBeenCalled();
  });

  it('refuses to operate on teams outside the administrator organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/999',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(del.statusCode).toBe(403);

    const join = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams/999/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob' }
    });
    expect(join.statusCode).toBe(403);
    expect(mockGitea.addTeamMember).not.toHaveBeenCalled();

    const leave = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/999/members/bob',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(leave.statusCode).toBe(403);
    expect(mockGitea.removeTeamMember).not.toHaveBeenCalled();
  });

  it('binds and unbinds members of an organization team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const join = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams/7/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob' }
    });
    expect(join.statusCode).toBe(201);
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(7, 'acme_bob');

    const leave = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/7/members/bob',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(leave.statusCode).toBe(200);
    expect(mockGitea.removeTeamMember).toHaveBeenCalledWith(7, 'acme_bob');
  });

  it('enables a member by restoring login and rejoining only default teams', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members/bob/enable',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: 'pending',
      username: 'acme_bob',
      operationId: expect.any(Number)
    });
    expect(mockGitea.enableUser).toHaveBeenCalledWith('acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(2, 'acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(3, 'acme_bob');
    expect(mockGitea.addTeamMember).not.toHaveBeenCalledWith(1, 'acme_bob');
    expect(mockGitea.addTeamMember).not.toHaveBeenCalledWith(7, 'acme_bob');
  });

  it('lists the members of an organization team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams/7/members',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }]);
    expect(mockGitea.listTeamMembers).toHaveBeenCalledWith(7);
  });

  it('rejects listing members of a team outside the organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams/999/members',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(403);
    expect(mockGitea.listTeamMembers).not.toHaveBeenCalledWith(999);
  });
});
