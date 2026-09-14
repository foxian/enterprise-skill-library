import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

interface OrgState {
  repos: { id: number; name: string; full_name: string }[];
  members: { id: number; username: string; email: string }[];
}

// 组织删除（ADR-0032 / #59）：同步简化流程，不再走 Operation 工作流；
// 成员是全局账号，删除只清理 ESL 登记的仓库与组织本身。
describe('organization deletion', () => {
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

  function seedActiveTenant(): void {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    new SkillRepository(db).createServerSkill({
      name: '@acme/reviewer',
      scope: 'acme',
      skillName: 'reviewer',
      description: 'Reviewer skill',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'acme/reviewer',
      status: 'active-published'
    });
    db.close();
  }

  function deletionGitea(
    state: OrgState,
    options: { failDeleteOrg?: boolean } = {}
  ) {
    return {
      validateAdminUserToken: vi.fn(async (token: string) =>
        token === 'super-token' ? { id: 1, username: 'eslroot', email: 'eslroot@local.esl' } : null
      ),
      validateToken: vi.fn().mockResolvedValue(null),
      organizationExists: vi.fn().mockResolvedValue(true),
      listOrgRepos: vi.fn(async () => state.repos),
      listOrgMembers: vi.fn(async () => state.members),
      deleteRepo: vi.fn(async (_org: string, name: string) => {
        state.repos = state.repos.filter((repo) => repo.name !== name);
      }),
      deleteUser: vi.fn(async (username: string) => {
        state.members = state.members.filter((member) => member.username !== username);
      }),
      deleteOrg: options.failDeleteOrg
        ? vi.fn().mockRejectedValue(new Error('Failed to delete Gitea organization: boom'))
        : vi.fn().mockResolvedValue(undefined)
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

  const acmeState = (): OrgState => ({
    repos: [{ id: 10, name: 'reviewer', full_name: 'acme/reviewer' }],
    members: [{ id: 2, username: 'alice', email: 'alice@local.esl' }]
  });

  const superHeaders = { authorization: 'token super-token' };

  it('deletes the organization synchronously and clears platform records', async () => {
    seedActiveTenant();
    const state = acmeState();
    const mockGitea = deletionGitea(state);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'deleted', orgName: 'acme' });
    expect(mockGitea.deleteRepo).toHaveBeenCalledWith('acme', 'reviewer');
    // 成员是全局账号（ADR-0032）：删除组织不删除账号
    expect(mockGitea.deleteUser).not.toHaveBeenCalled();
    expect(mockGitea.deleteOrg).toHaveBeenCalledWith('acme');

    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@acme/reviewer')).toBeUndefined();
    expect(db.prepare('SELECT status FROM tenant_organizations WHERE org_name = ?').get('acme')).toEqual({
      status: 'deleted'
    });
    db.close();
  });

  it('requires a confirm field matching the organization name', async () => {
    seedActiveTenant();
    const state = acmeState();
    const mockGitea = deletionGitea(state);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const mismatch = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'wrong' }
    });

    expect(mismatch.statusCode).toBe(400);
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();
  });

  it('returns 404 for an organization ESL does not manage', async () => {
    const mockGitea = deletionGitea(acmeState());
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/ghost',
      headers: superHeaders,
      payload: { confirm: 'ghost' }
    });

    expect(response.statusCode).toBe(404);
  });

  it('reports failure and keeps records when Git Backend cleanup fails', async () => {
    seedActiveTenant();
    const state = acmeState();
    const mockGitea = deletionGitea(state, { failDeleteOrg: true });
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().retryable).toBe(true);
    const row = tenantRow();
    expect(row.status).toBe('delete_failed');
    expect(row.last_error_json).toContain('Gitea organization');
    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@acme/reviewer')).toBeDefined();
    db.close();
  });

  it('stops automatic cleanup when an external repository is found', async () => {
    seedActiveTenant();
    const state = acmeState();
    state.repos.push({ id: 11, name: 'external', full_name: 'acme/external' });
    const mockGitea = deletionGitea(state);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('provenance');
    expect(mockGitea.deleteRepo).not.toHaveBeenCalled();
    expect(mockGitea.deleteOrg).not.toHaveBeenCalled();
  });

  it('can be retried after a failure', async () => {
    seedActiveTenant();
    const state = acmeState();
    const deleteOrg = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to delete Gitea organization: boom'))
      .mockResolvedValue(undefined);
    const mockGitea = { ...deletionGitea(state), deleteOrg };
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const first = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });
    expect(first.statusCode).toBe(409);

    const second = await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme',
      headers: superHeaders,
      payload: { confirm: 'acme' }
    });
    expect(second.statusCode).toBe(200);
    expect(tenantRow().status).toBe('deleted');
  });
});

// 组织生命周期状态门禁（ADR-0032）：非 active 组织禁止技能与组织管理操作。
describe('organization lifecycle access control', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-lifecycle-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function consoleGitea(): GlobalGiteaFake {
    const gitea = createGlobalGitea({
      users: [{ username: 'admin-alice', password: 'password-123' }],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.setOrgOwner('acme', 'admin-alice');
    gitea.validateToken.mockImplementation(async (token: string) =>
      token === 'acme-token' ? { id: 2, username: 'admin-alice', email: 'admin-alice@local.esl' } : null
    );
    return gitea;
  }

  function seedTenantWithStatus(status: string): void {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: status as any });
    db.close();
  }

  for (const status of ['provisioning', 'failed', 'deleting', 'delete_failed']) {
    it(`rejects skill operations and org management while ${status}`, async () => {
      seedTenantWithStatus(status);
      const mockGitea = consoleGitea();
      app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

      const skillCreate = await app.inject({
        method: 'POST',
        url: '/api/skills/upload',
        headers: { authorization: 'token acme-token' },
        payload: { name: '@acme/new-skill', description: 'New skill' }
      });
      // 上传路由自行校验目标组织状态（403：组织未激活）
      expect(skillCreate.statusCode).toBe(403);

      const memberAdd = await app.inject({
        method: 'POST',
        url: '/api/orgs/acme/members',
        headers: { authorization: 'token acme-token' },
        payload: { username: 'bob' }
      });
      expect(memberAdd.statusCode).toBe(409);
    });
  }

  it('allows org management while the organization is active', async () => {
    seedTenantWithStatus('active');
    const mockGitea = consoleGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const members = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme/members',
      headers: { authorization: 'token acme-token' }
    });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toEqual([
      expect.objectContaining({ username: 'admin-alice' })
    ]);
  });
});
