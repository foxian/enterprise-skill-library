import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 组织治理权（ADR-0033 / ADR-0034）：组织管理团队成员可互管、可删除组织；
// 平台管理员不经成员身份也有同款能力，但"组织管理团队至少保留一名成员"这条
// 不变量对谁都不破例——无主组织不是可治理状态。
describe('organization governance powers', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-governance-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function giteaWithMembers(): GlobalGiteaFake {
    const gitea = createGlobalGitea({
      users: [
        { username: 'admin-alice', password: 'password-123' },
        { username: 'co-admin', password: 'password-123' },
        { username: 'bob', password: 'password-123' },
        { username: 'eslroot', password: 'root-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.setOrgOwner('acme', 'admin-alice');
    gitea.__state.setOrgOwner('acme', 'co-admin');
    gitea.__state.addOrgMember('acme', 'admin-alice');
    gitea.__state.addOrgMember('acme', 'co-admin');
    gitea.__state.addOrgMember('acme', 'bob');
    gitea.validateToken.mockImplementation(async (token: string) => {
      const map: Record<string, string> = {
        'manager-token': 'admin-alice',
        'co-token': 'co-admin',
        'member-token': 'bob'
      };
      const username = map[token];
      return username ? { id: 2, username, email: `${username}@local.esl` } : null;
    });
    return gitea;
  }

  function seedActiveTenant(): void {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    db.close();
  }

  function tenantStatus(): string {
    const db = initDatabase(dbPath);
    const row = db
      .prepare('SELECT status FROM tenant_organizations WHERE org_name = ?')
      .get('acme') as { status: string };
    db.close();
    return row.status;
  }

  const managerHeaders = { authorization: 'token manager-token' };

  async function buildWith(gitea: GlobalGiteaFake): Promise<void> {
    app = await buildApp({ dbPath, giteaService: { ...gitea } as never, repoOwner: 'esl-skills' });
  }

  it('lets an organization management team member delete the organization', async () => {
    seedActiveTenant();
    const gitea = giteaWithMembers();
    await buildWith(gitea);

    const res = await app!.inject({
      method: 'DELETE',
      url: '/api/orgs/acme',
      headers: managerHeaders,
      payload: { confirm: 'acme' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'deleted', orgName: 'acme' });
    expect(tenantStatus()).toBe('deleted');
    expect(await gitea.organizationExists('acme')).toBe(false);
  });

  it('refuses deletion from a plain organization member', async () => {
    seedActiveTenant();
    const gitea = giteaWithMembers();
    await buildWith(gitea);

    const res = await app!.inject({
      method: 'DELETE',
      url: '/api/orgs/acme',
      headers: { authorization: 'token member-token' },
      payload: { confirm: 'acme' }
    });

    expect(res.statusCode).toBe(403);
    expect(tenantStatus()).toBe('active');
  });

  it('requires a confirm field matching the organization name', async () => {
    seedActiveTenant();
    const gitea = giteaWithMembers();
    await buildWith(gitea);

    const res = await app!.inject({
      method: 'DELETE',
      url: '/api/orgs/acme',
      headers: managerHeaders,
      payload: { confirm: 'wrong' }
    });

    expect(res.statusCode).toBe(400);
    expect(tenantStatus()).toBe('active');
  });

  it('refuses to delete an organization ESL does not manage', async () => {
    // 无租户登记 = 不是 ESL 开通的组织（可能是直接在 Git Backend 建的），不自动删
    const gitea = giteaWithMembers();
    await buildWith(gitea);

    const res = await app!.inject({
      method: 'DELETE',
      url: '/api/orgs/acme',
      headers: managerHeaders,
      payload: { confirm: 'acme' }
    });

    expect(res.statusCode).toBe(404);
  });

  it('lets the organization management team retry a failed deletion', async () => {
    seedActiveTenant();
    const gitea = giteaWithMembers();
    const deleteOrg = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to delete Gitea organization: boom'))
      .mockResolvedValue(undefined);
    app = await buildApp({
      dbPath,
      giteaService: { ...gitea, deleteOrg } as never,
      repoOwner: 'esl-skills'
    });

    const first = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme',
      headers: managerHeaders,
      payload: { confirm: 'acme' }
    });
    expect(first.statusCode).toBe(409);
    expect(first.json().retryable).toBe(true);
    expect(tenantStatus()).toBe('delete_failed');

    // 删除失败后组织对其他管理操作关闭，但删除重试必须放行——否则失败态只能
    // 等平台管理员来收拾，而 ADR-0034 要的是治理者看得见、也修得了。
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme/members',
      headers: managerHeaders
    });
    expect(blocked.statusCode).toBe(409);

    const second = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme',
      headers: managerHeaders,
      payload: { confirm: 'acme' }
    });
    expect(second.statusCode).toBe(200);
    expect(tenantStatus()).toBe('deleted');
  });

  it('keeps the last organization management team member from everyone', async () => {
    const gitea = giteaWithMembers();
    const superToken = (await gitea.loginUser('eslroot', 'root-password'))!;
    await buildWith(gitea);
    const superHeaders = { authorization: `token ${superToken}` };

    // 先由治理者移除同僚，团队只剩一名成员
    const first = await app!.inject({
      method: 'DELETE',
      url: '/api/orgs/acme/members/co-admin',
      headers: managerHeaders
    });
    expect(first.statusCode).toBe(200);

    // 最后一名：平台管理员也不能移除——留下的会是无主组织
    const last = await app!.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme/members/admin-alice',
      headers: superHeaders
    });
    expect(last.statusCode).toBe(400);
    expect(last.json().error).toContain('at least one member');
    expect((await gitea.listOrgMembers('acme')).map((member) => member.username)).toContain('admin-alice');
  });

  it('lets the platform administrator inspect and remove org members without being one', async () => {
    const gitea = giteaWithMembers();
    const superToken = (await gitea.loginUser('eslroot', 'root-password'))!;
    await buildWith(gitea);
    const superHeaders = { authorization: `token ${superToken}` };

    const members = await app!.inject({
      method: 'GET',
      url: '/api/admin/orgs/acme/members',
      headers: superHeaders
    });

    expect(members.statusCode).toBe(200);
    expect(members.json()).toEqual([
      expect.objectContaining({ username: 'admin-alice', isOrgManager: true }),
      expect.objectContaining({ username: 'co-admin', isOrgManager: true }),
      expect.objectContaining({ username: 'bob', isOrgManager: false })
    ]);

    const removed = await app!.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/acme/members/bob',
      headers: superHeaders
    });
    expect(removed.statusCode).toBe(200);
    expect((await gitea.listOrgMembers('acme')).map((member) => member.username)).toEqual([
      'admin-alice',
      'co-admin'
    ]);
  });
});
