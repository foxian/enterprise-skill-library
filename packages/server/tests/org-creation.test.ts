import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';
import { GiteaRequestError } from '../src/services/gitea.js';

// npm 式组织创建（ADR-0032 / #54）：auto 即时开通、manual 申请审批（同步开通）、
// 四个常设团队预置；部署模式 / 默认组织 / <org>_admin / system-admins 全部拆除。
describe('organization creation', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;
  let superToken: string;

  async function switchMode(mode: 'auto' | 'manual'): Promise<void> {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: { authorization: `token ${superToken}` },
      payload: { orgRegistrationMode: mode }
    });
    expect(res.statusCode).toBe(200);
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-create-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'eslroot', password: 'root-password' }
      ],
      orgs: []
    });
    superToken = (await gitea.loginUser('eslroot', 'root-password'))!;
    const db = initDatabase(dbPath);
    db.close();
    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
    gitea.validateToken.mockImplementation(async (token: string) =>
      token === 'alice-token' ? { id: 1, username: 'alice', email: 'alice@local.esl' } : null
    );
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function ownerMembers(orgName: string): Promise<string[]> {
    const teams = await gitea.listTeams(orgName);
    const owners = teams.find((team) => team.permission === 'owner')!;
    return (await gitea.listTeamMembers(owners.id)).map((member) => member.username);
  }

  it('lists my organizations with per-organization identity', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'acme' }
    });
    await gitea.createOrg('beta');
    gitea.__state.addOrgMember('beta', 'alice');

    const res = await app.inject({
      method: 'GET',
      url: '/api/orgs/mine',
      headers: { authorization: 'token alice-token' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().organizations).toEqual([
      { org: 'acme', identity: 'owner', isOwnerMember: true, status: 'active' },
      { org: 'beta', identity: 'ordinary', isOwnerMember: false, status: 'active' }
    ]);
    expect(res.json().pendingApplications).toEqual([]);
  });

  it('surfaces my own pending organization applications separately from organizations', async () => {
    await switchMode('manual');
    await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'gamma' }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/orgs/mine',
      headers: { authorization: 'token alice-token' }
    });

    // 待审申请尚未产生 Gitea 组织，因此不在 organizations 里
    expect(res.json().organizations).toEqual([]);
    expect(res.json().pendingApplications).toEqual([
      { orgName: 'gamma', submittedAt: expect.any(String) }
    ]);
  });

  it('returns the organization name to the flat pool after deletion', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'acme' }
    });

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme',
      headers: { authorization: 'token alice-token' },
      payload: { confirm: 'acme' }
    });
    expect(deleted.statusCode).toBe(200);

    // 名字回到扁平池（ADR-0034）：同名组织可以重新创建。这与技能 Identity 的
    // "永不复用"相反——技能 Identity 承载安装在外的引用，组织名不承载。
    const recreated = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'acme' }
    });
    expect(recreated.statusCode).toBe(201);

    const mine = await app.inject({
      method: 'GET',
      url: '/api/orgs/mine',
      headers: { authorization: 'token alice-token' }
    });
    expect(mine.json().organizations).toEqual([
      { org: 'acme', identity: 'owner', isOwnerMember: true, status: 'active' }
    ]);
  });

  it('auto mode creates the organization instantly with the creator in the management team', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ orgName: 'beta', status: 'active', identity: 'owner', isOwnerMember: true });
    expect(gitea.createOrg).toHaveBeenCalledWith('beta');
    expect(await ownerMembers('beta')).toContain('alice');
  });

  // 回归：用 admin token 建组织会把站点管理员自动塞进 Owners。平台系统账号不属于
  // 任何组织（ADR-0033），既是治理团队成员又是组织成员都不行——只摘 Owners 会留下
  // 一个"在成员列表里、却没有任何团队"的残影。
  it('leaves the platform administrator out of the new organization entirely', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    expect(await ownerMembers('beta')).not.toContain('eslroot');
    expect((await gitea.listOrgMembers('beta')).map((member) => member.username)).not.toContain('eslroot');
  });

  it('presets the four standing teams with display names on creation', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    const teams = await gitea.listTeams('beta');
    const names = teams.map((team) => team.name).sort();
    expect(names).toEqual(['all-managers', 'all-readers', 'all-writers', 'Owners'].sort());
    // Owners 是管理员团队（第四常设团队），其余三档权限固定
    const byName = new Map(teams.map((team) => [team.name, team.permission]));
    expect(byName.get('Owners')).toBe('owner');
    expect(byName.get('all-readers')).toBe('read');
    expect(byName.get('all-writers')).toBe('write');
    expect(byName.get('all-managers')).toBe('admin');
  });

  it('rejects creation with a reserved or taken name at submission time', async () => {
    await gitea.createOrg('taken');
    for (const [name, status] of [
      ['system', 400],
      ['taken', 409],
      ['alice', 409]
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/orgs',
        headers: { authorization: 'token alice-token' },
        payload: { orgName: name }
      });
      expect(res.statusCode).toBe(status);
    }
  });

  it('manual mode queues an application; approval provisions synchronously with the applicant as admin', async () => {
    await switchMode('manual');

    const apply = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    expect(apply.statusCode).toBe(201);
    expect(apply.json()).toMatchObject({ status: 'pending' });
    expect(gitea.createOrg).not.toHaveBeenCalled();

    const approve = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/approve',
      headers: { authorization: `token ${superToken}` }
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json()).toMatchObject({ status: 'active', orgName: 'beta', applicant: 'alice' });
    expect(gitea.createOrg).toHaveBeenCalledWith('beta');
    expect(await ownerMembers('beta')).toContain('alice');
    const teams = await gitea.listTeams('beta');
    expect(teams.map((team) => team.name).sort()).toEqual(
      ['all-managers', 'all-readers', 'all-writers', 'Owners'].sort()
    );
  });

  it('rejecting an application releases the name for new applications', async () => {
    await switchMode('manual');
    await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/reject',
      headers: { authorization: `token ${superToken}` }
    });

    const reapply = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    expect(reapply.statusCode).toBe(201);
    expect(gitea.createOrg).not.toHaveBeenCalled();
  });

  it('lets auto mode create an organization whose name was previously rejected', async () => {
    // 被拒的组织名已释放（ADR-0032）：auto 模式重建立即可用，不残留冲突
    await switchMode('manual');
    await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/reject',
      headers: { authorization: `token ${superToken}` }
    });
    await switchMode('auto');

    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    expect(res.statusCode).toBe(201);
    expect(await ownerMembers('beta')).toContain('alice');
  });

  it('lets a deleted organization name be applied for again in manual mode', async () => {
    await switchMode('manual');
    await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/approve',
      headers: { authorization: `token ${superToken}` }
    });
    // 删除组织：名字释放
    gitea.listOrgRepos.mockResolvedValue([]);
    await app.inject({
      method: 'DELETE',
      url: '/api/admin/orgs/beta',
      headers: { authorization: `token ${superToken}` },
      payload: { confirm: 'beta' }
    });

    const reapply = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    expect(reapply.statusCode).toBe(201);
    expect(reapply.json()).toMatchObject({ status: 'pending' });
  });

  it('adds the creator to the three standing teams at creation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    expect(res.statusCode).toBe(201);

    for (const name of ['all-readers', 'all-writers', 'all-managers']) {
      const team = (await gitea.listTeams('beta')).find((entry) => entry.name === name)!;
      expect(await gitea.isTeamMember(team.id, 'alice')).toBe(true);
    }
  });

  it('maps a Git Backend name conflict to 409 instead of 500', async () => {
    // 并发窗口：预检通过后 Git Backend 仍可能拒绝重名（422）
    gitea.createOrg.mockRejectedValueOnce(
      new GiteaRequestError(422, 'Failed to create Gitea organization: user already exists')
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already exists');
  });

  it('reports an unreachable Git Backend as 502 rather than 500', async () => {
    gitea.createOrg.mockRejectedValueOnce(
      new GiteaRequestError(502, 'Failed to create Gitea organization: upstream unavailable')
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    expect(res.statusCode).toBe(502);
  });

  it('refuses to claim an organization that already exists in the Git Backend', async () => {
    // 预检时不存在，开通时已被他人建出：绝不把调用者塞进既有组织的 Owners
    gitea.organizationExists
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    expect(res.statusCode).toBe(409);
    expect(gitea.createOrg).not.toHaveBeenCalled();
    expect(res.json().error).toContain('already taken');
  });

  it('deduplicates a pending application with the same name at submission time', async () => {
    await switchMode('manual');
    await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toContain('pending');
  });
});
