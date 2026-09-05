import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  initDatabase,
  OperationRepository,
  SkillRepository,
  TenantOrganizationRepository
} from '../src/db/database.js';

interface OrgState {
  repos: { id: number; name: string; full_name: string }[];
  members: { id: number; username: string; email: string }[];
}

describe('tenant organization deletion workflow', () => {
  const applicationEncryptionKey = 'a'.repeat(64);
  const superHeaders = { authorization: 'token super-token' };
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-delete-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function seedActiveTenant(): void {
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
      gitRepoPath: 'acme/acme_reviewer',
      status: 'active-published'
    });
    new OperationRepository(db).createOperation({
      idempotencyKey: 'member.create:acme:acme_bob',
      kind: 'member.create',
      payload: { orgName: 'acme', username: 'acme_bob' }
    });
    db.close();
  }

  function acmeState(): OrgState {
    return {
      repos: [{ id: 10, name: 'acme_reviewer', full_name: 'acme/acme_reviewer' }],
      members: [
        { id: 2, username: 'acme_admin', email: 'acme_admin@local.esl' },
        { id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }
      ]
    };
  }

  function deletionGitea(
    state: OrgState,
    options: { hangDeleteOrg?: boolean; failDeleteOrg?: boolean; failDeleteOrgOnce?: boolean } = {}
  ) {
    let deleteOrg: ReturnType<typeof vi.fn>;
    if (options.hangDeleteOrg) {
      deleteOrg = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
    } else if (options.failDeleteOrg) {
      deleteOrg = vi.fn().mockRejectedValue(new Error('Failed to delete Gitea organization: boom'));
    } else if (options.failDeleteOrgOnce) {
      deleteOrg = vi
        .fn()
        .mockRejectedValueOnce(new Error('Failed to delete Gitea organization: boom'))
        .mockResolvedValue(undefined);
    } else {
      deleteOrg = vi.fn().mockResolvedValue(undefined);
    }
    return {
      validateAdminUserToken: vi.fn(async (token: string) =>
        token === 'super-token' ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
      ),
      organizationExists: vi.fn().mockResolvedValue(true),
      listOrgRepos: vi.fn(async () => state.repos),
      listOrgMembers: vi.fn(async () => state.members),
      deleteRepo: vi.fn(async (_org: string, name: string) => {
        state.repos = state.repos.filter((repo) => repo.name !== name);
      }),
      deleteUser: vi.fn(async (username: string) => {
        state.members = state.members.filter((member) => member.username !== username);
      }),
      deleteOrg
    };
  }

  function tenantRow(): { status: string; last_error_json: string | null } {
    const db = initDatabase(dbPath);
    const row = db
      .prepare('SELECT status, last_error_json FROM tenant_organizations WHERE org_name = ?')
      .get('acme') as { status: string; last_error_json: string | null };
    db.close();
    return row;
  }

  it('marks the organization deleting immediately and cleans up before platform records', async () => {
    seedActiveTenant();
    const state = acmeState();
    // deleteOrg 永不返回,执行器停在 Git Backend 清理阶段,便于断言中间状态。
    const mockGitea = deletionGitea(state, { hangDeleteOrg: true });
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });

    expect(response.statusCode).toBe(202);
    const operationId = response.json().operationId;
    expect(typeof operationId).toBe('number');
    await flush();

    expect(tenantRow().status).toBe('deleting');
    expect(mockGitea.deleteRepo).toHaveBeenCalledWith('acme', 'acme_reviewer');
    expect(mockGitea.deleteUser).toHaveBeenCalledWith('acme_admin');
    expect(mockGitea.deleteUser).toHaveBeenCalledWith('acme_bob');
    expect(mockGitea.deleteOrg).toHaveBeenCalledWith('acme');
    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@acme/reviewer')).toBeDefined();
    expect(db.prepare('SELECT status FROM operations WHERE id = ?').get(operationId)).toMatchObject({
      status: 'running'
    });
    db.close();
  });

  it('completes deletion and clears platform records after Git Backend cleanup succeeds', async () => {
    seedActiveTenant();
    const state = acmeState();
    const mockGitea = deletionGitea(state);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });
    expect(response.statusCode).toBe(202);
    const operationId = response.json().operationId;
    await flush();

    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@acme/reviewer')).toBeUndefined();
    expect(db.prepare('SELECT status FROM tenant_organizations WHERE org_name = ?').get('acme')).toEqual({
      status: 'deleted'
    });
    expect(db.prepare('SELECT status FROM operations WHERE id = ?').get(operationId)).toMatchObject({
      status: 'succeeded'
    });
    db.close();
  });

  it('keeps platform skill records when Git Backend cleanup fails', async () => {
    seedActiveTenant();
    const state = acmeState();
    const mockGitea = deletionGitea(state, { failDeleteOrg: true });
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });
    expect(response.statusCode).toBe(202);
    await flush();

    expect(mockGitea.deleteRepo).toHaveBeenCalled();
    expect(mockGitea.deleteOrg).toHaveBeenCalled();
    const row = tenantRow();
    expect(row.status).toBe('delete_failed');
    const failure = JSON.parse(row.last_error_json ?? '{}');
    expect(failure.message).toContain('Gitea organization');
    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@acme/reviewer')).toBeDefined();
    db.close();
  });

  it('resumes deletion from completed steps when the administrator retries', async () => {
    seedActiveTenant();
    const state = acmeState();
    const mockGitea = deletionGitea(state, { failDeleteOrgOnce: true });
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const first = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });
    expect(first.statusCode).toBe(202);
    const operationId = first.json().operationId;
    await flush();
    expect(tenantRow().status).toBe('delete_failed');
    expect(state.repos).toEqual([]);
    expect(state.members).toEqual([]);

    const retry = await app.inject({
      method: 'POST',
      url: `/api/admin/operations/${operationId}/retry`,
      headers: superHeaders
    });
    expect(retry.statusCode).toBe(200);
    await flush();

    // 已完成的步骤不重复执行:仓库与账号只在首次尝试中被删除
    expect(mockGitea.deleteRepo).toHaveBeenCalledTimes(1);
    expect(mockGitea.deleteUser).toHaveBeenCalledTimes(2);
    expect(mockGitea.deleteOrg).toHaveBeenCalledTimes(2);
    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@acme/reviewer')).toBeUndefined();
    expect(db.prepare('SELECT status FROM tenant_organizations WHERE org_name = ?').get('acme')).toEqual({
      status: 'deleted'
    });
    expect(db.prepare('SELECT status FROM operations WHERE id = ?').get(operationId)).toMatchObject({
      status: 'succeeded'
    });
    db.close();
  });

  it('stops automatic cleanup and records the reason when an external repository is found', async () => {
    seedActiveTenant();
    const state = acmeState();
    state.repos.push({ id: 11, name: 'outsider', full_name: 'acme/outsider' });
    const mockGitea = deletionGitea(state);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });
    expect(response.statusCode).toBe(202);
    await flush();

    expect(mockGitea.deleteRepo).not.toHaveBeenCalled();
    expect(mockGitea.deleteUser).not.toHaveBeenCalled();
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();
    const row = tenantRow();
    expect(row.status).toBe('delete_failed');
    const failure = JSON.parse(row.last_error_json ?? '{}');
    expect(failure.code).toBe('EXTERNAL_RESOURCE');
    expect(failure.details.resources).toContain('repository acme/outsider');
    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@acme/reviewer')).toBeDefined();
    const operation = db.prepare('SELECT status, error_json FROM operations WHERE kind = ?').get('organization.delete') as {
      status: string;
      error_json: string;
    };
    expect(operation.status).toBe('failed');
    expect(JSON.parse(operation.error_json).code).toBe('EXTERNAL_RESOURCE');
    db.close();
  });

  it('stops automatic cleanup when an org-specific account lacks provenance', async () => {
    seedActiveTenant();
    const state = acmeState();
    state.members.push({ id: 4, username: 'acme_rogue', email: 'acme_rogue@local.esl' });
    const mockGitea = deletionGitea(state);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });
    expect(response.statusCode).toBe(202);
    await flush();

    expect(mockGitea.deleteUser).not.toHaveBeenCalled();
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();
    const failure = JSON.parse(tenantRow().last_error_json ?? '{}');
    expect(failure.code).toBe('EXTERNAL_RESOURCE');
    expect(failure.details.resources).toContain('account acme_rogue');
  });

  it('returns the existing operation status for duplicate delete requests after completion', async () => {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'deleted' });
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'organization.delete:acme',
      kind: 'organization.delete',
      payload: { orgName: 'acme' }
    });
    db.prepare(`UPDATE operations SET status = 'succeeded' WHERE id = ?`).run(operation.id);
    db.close();

    const state = acmeState();
    const mockGitea = deletionGitea(state);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const duplicate = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({ status: 'succeeded', orgName: 'acme', operationId: operation.id });
    expect(mockGitea.deleteRepo).not.toHaveBeenCalled();
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();
    // 终态幂等:重复请求不得把已删除组织重置回 deleting
    expect(tenantRow().status).toBe('deleted');
  });

  it('returns the existing operation status for duplicate delete requests while failed', async () => {
    seedActiveTenant();
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).transition('acme', 'delete_failed');
    const operation = new OperationRepository(db).createOperation({
      idempotencyKey: 'organization.delete:acme',
      kind: 'organization.delete',
      payload: { orgName: 'acme' }
    });
    // next_retry_at 置为未来,避免 buildApp 启动时的 processPending 认领重跑。
    db.prepare(`
      UPDATE operations
      SET status = 'failed', next_retry_at = '2999-01-01T00:00:00.000Z'
      WHERE id = ?
    `).run(operation.id);
    db.close();

    const state = acmeState();
    const mockGitea = deletionGitea(state);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const duplicate = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({ status: 'failed', orgName: 'acme', operationId: operation.id });
    expect(mockGitea.deleteRepo).not.toHaveBeenCalled();
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();
    expect(tenantRow().status).toBe('delete_failed');
  });

  it('refuses to delete an organization without ESL provenance', async () => {
    const state = acmeState();
    const mockGitea = deletionGitea(state);
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/platform-ai',
      headers: superHeaders,
      payload: { confirm: 'platform-ai' }
    });

    expect(response.statusCode).toBe(404);
    expect(mockGitea.deleteRepo).not.toHaveBeenCalled();
    expect(mockGitea.deleteUser).not.toHaveBeenCalled();
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();
  });
});

describe('organization lifecycle access control', () => {
  const applicationEncryptionKey = 'a'.repeat(64);
  const superHeaders = { authorization: 'token super-token' };
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-access-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function consoleGitea() {
    return {
      validateToken: vi.fn(async (token: string) =>
        token === 'acme-token' ? { id: 2, username: 'acme_admin', email: 'acme_admin@local.esl' } : null
      ),
      loginUser: vi.fn().mockResolvedValue('issued-gitea-token'),
      organizationExists: vi.fn().mockResolvedValue(true),
      listOrgMembers: vi.fn().mockResolvedValue([{ username: 'acme_bob' }]),
      listTeams: vi.fn().mockResolvedValue([{ id: 1, name: 'Owners', permission: 'owner' }]),
      createTeam: vi.fn().mockResolvedValue({ id: 5, name: 'dev', permission: 'read' })
    };
  }

  function seedTenantWithStatus(status: string): void {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: status as any });
    db.close();
  }

  for (const status of ['provisioning', 'failed', 'deleting', 'delete_failed']) {
    it(`rejects logins, skill operations, and org management while ${status}`, async () => {
      seedTenantWithStatus(status);
      const mockGitea = consoleGitea();
      app = await buildApp({
        dbPath,
        giteaService: mockGitea as any,
        repoOwner: 'esl-skills',
        applicationEncryptionKey
      });

      const memberLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { org: 'acme', username: 'bob', password: 'whatever-password' }
      });
      expect(memberLogin.statusCode).toBe(409);
      expect(mockGitea.loginUser).not.toHaveBeenCalled();

      const adminLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { org: 'acme', username: 'admin', password: 'whatever-password' }
      });
      expect(adminLogin.statusCode).toBe(409);

      const skillCreate = await app.inject({
        method: 'POST',
        url: '/api/skills',
        payload: { name: '@acme/new-skill', description: 'New skill', version: '1.0.0' }
      });
      expect(skillCreate.statusCode).toBe(409);
      expect(mockGitea.createTeam).not.toHaveBeenCalled();

      const memberCreate = await app.inject({
        method: 'POST',
        url: '/api/orgs/members',
        headers: { authorization: 'token acme-token' },
        payload: { username: 'bob', password: 'a-strong-password' }
      });
      expect(memberCreate.statusCode).toBe(409);

      const teamCreate = await app.inject({
        method: 'POST',
        url: '/api/orgs/teams',
        headers: { authorization: 'token acme-token' },
        payload: { name: 'dev', permission: 'read' }
      });
      expect(teamCreate.statusCode).toBe(409);
      expect(mockGitea.createTeam).not.toHaveBeenCalled();
    });
  }

  it('allows logins and org management while the organization is active', async () => {
    seedTenantWithStatus('active');
    const mockGitea = consoleGitea();
    app = await buildApp({
      dbPath,
      giteaService: mockGitea as any,
      repoOwner: 'esl-skills',
      applicationEncryptionKey
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { org: 'acme', username: 'bob', password: 'whatever-password' }
    });
    expect(login.statusCode).toBe(200);

    const members = await app.inject({
      method: 'GET',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-token' }
    });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toEqual([{ username: 'acme_bob' }]);
  });
});
