import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase } from '../src/db/database.js';

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

  it('lists the teams of the administrator organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(defaultTeams);
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
