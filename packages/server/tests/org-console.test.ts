import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, PlatformSettingsRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 组织成员治理（ADR-0032 / #55）：成员 = 全局账号；拉人方式为平台设置
// （direct 即生效 / invite 对方接受后入组）；常设团队随成员进出自动增删；
// 自定义团队由任意 组织管理团队（Owners 成员）管理，常设团队不可删改。
describe('organization console API', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-console-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'admin-alice', password: 'password-123' },
        { username: 'co-admin', password: 'password-123' },
        { username: 'bob', password: 'password-123' },
        { username: 'carol', password: 'password-123' },
        { username: 'outsider', password: 'password-123' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    // acme 的 Owners：admin-alice 与 co-admin（任意 Owners 成员皆可治理）
    gitea.__state.setOrgOwner('acme', 'admin-alice');
    gitea.__state.setOrgOwner('acme', 'co-admin');
    // 常设团队预置（生产路径由 initializeOrganization 完成）
    await gitea.createTeam('acme', 'all-readers', 'read');
    await gitea.createTeam('acme', 'all-writers', 'write');
    await gitea.createTeam('acme', 'all-managers', 'admin');
    // bob 已是普通成员（挂在只读常设团队）
    await gitea.addTeamMember((await teamId('acme', 'all-readers'))!, 'bob');

    const db = initDatabase(dbPath);
    db.close();
    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
    gitea.validateToken.mockImplementation(async (token: string) => {
      const map: Record<string, string> = {
        'alice-token': 'admin-alice',
        'co-token': 'co-admin',
        'bob-token': 'bob',
        'carol-token': 'carol',
        'outsider-token': 'outsider'
      };
      const username = map[token];
      return username ? { id: 1, username, email: `${username}@local.esl` } : null;
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const aliceHeaders = { authorization: 'token alice-token' };

  function teamId(org: string, name: string): Promise<number | undefined> {
    return gitea.listTeams(org).then((teams) => teams.find((team) => team.name === name)?.id);
  }

  it('rejects callers who are not Owners members of the target organization', async () => {
    for (const [token, org] of [
      ['bob-token', 'acme'],
      ['outsider-token', 'acme'],
      ['alice-token', 'elsewhere']
    ] as const) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/orgs/${org}/members`,
        headers: { authorization: `token ${token}` }
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('direct-add puts an existing global account into the org as an ordinary member', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/members',
      headers: aliceHeaders,
      payload: { username: 'carol' }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'added', username: 'carol' });
    // 普通成员只进只读、读写两个常设团队——技能管理团队承载管理成员身份，
    // 要显式授予（ADR-0036）
    for (const name of ['all-readers', 'all-writers']) {
      const id = await teamId('acme', name);
      expect(await gitea.isTeamMember(id!, 'carol')).toBe(true);
    }
    const managingId = await teamId('acme', 'all-managers');
    expect(await gitea.isTeamMember(managingId!, 'carol')).toBe(false);
  });

  it('refuses to add a non-existent account or an existing member', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/members',
      headers: aliceHeaders,
      payload: { username: 'ghost' }
    });
    expect(missing.statusCode).toBe(404);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/members',
      headers: aliceHeaders,
      payload: { username: 'bob' }
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('invite mode records an invitation; the invitee joins only after accepting', async () => {
    const db = initDatabase(dbPath);
    new PlatformSettingsRepository(db).setSetting('member_add_mode', 'invite');
    db.close();

    const invite = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/members',
      headers: aliceHeaders,
      payload: { username: 'carol' }
    });
    expect(invite.statusCode).toBe(202);
    expect(invite.json()).toMatchObject({ status: 'invited', username: 'carol' });
    expect(await gitea.listUserOrgs('carol')).toEqual([]);

    // 组织管理团队成员可见待处理邀请
    const list = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme/invitations',
      headers: aliceHeaders
    });
    expect(list.json()).toEqual([expect.objectContaining({ username: 'carol', status: 'pending' })]);

    // 被邀请人看到并接受
    const mine = await app.inject({
      method: 'GET',
      url: '/api/orgs/invitations',
      headers: { authorization: 'token carol-token' }
    });
    expect(mine.json()).toHaveLength(1);
    const accept = await app.inject({
      method: 'POST',
      url: `/api/orgs/invitations/${mine.json()[0].id}/accept`,
      headers: { authorization: 'token carol-token' }
    });
    expect(accept.statusCode).toBe(200);
    for (const name of ['all-readers', 'all-writers']) {
      const id = await teamId('acme', name);
      expect(await gitea.isTeamMember(id!, 'carol')).toBe(true);
    }
    const managingId = await teamId('acme', 'all-managers');
    expect(await gitea.isTeamMember(managingId!, 'carol')).toBe(false);
  });

  it('declining an invitation leaves the org untouched', async () => {
    const db = initDatabase(dbPath);
    new PlatformSettingsRepository(db).setSetting('member_add_mode', 'invite');
    db.close();
    await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/members',
      headers: aliceHeaders,
      payload: { username: 'carol' }
    });
    const mine = await app.inject({
      method: 'GET',
      url: '/api/orgs/invitations',
      headers: { authorization: 'token carol-token' }
    });

    const decline = await app.inject({
      method: 'POST',
      url: `/api/orgs/invitations/${mine.json()[0].id}/decline`,
      headers: { authorization: 'token carol-token' }
    });
    expect(decline.statusCode).toBe(200);
    expect(await gitea.listUserOrgs('carol')).toEqual([]);
  });

  // 邀请的发起方半边：被邀请人还没回应时，邀请不该是不可收回的。
  it('lets the organization withdraw a pending invitation', async () => {
    const db = initDatabase(dbPath);
    new PlatformSettingsRepository(db).setSetting('member_add_mode', 'invite');
    db.close();
    await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/members',
      headers: aliceHeaders,
      payload: { username: 'carol' }
    });
    const pending = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme/invitations',
      headers: aliceHeaders
    });
    const invitationId = (pending.json() as Array<{ id: number }>)[0].id;

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/acme/invitations/${invitationId}`,
      headers: aliceHeaders
    });

    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toMatchObject({ status: 'revoked', username: 'carol' });
    // 被邀请人的待办里不再出现，也不产生任何成员关系
    const mine = await app.inject({
      method: 'GET',
      url: '/api/orgs/invitations',
      headers: { authorization: 'token carol-token' }
    });
    expect(mine.json()).toEqual([]);
    expect(await gitea.listUserOrgs('carol')).toEqual([]);

    // 已撤销的邀请不能被再次接受
    const accept = await app.inject({
      method: 'POST',
      url: `/api/orgs/invitations/${invitationId}/accept`,
      headers: { authorization: 'token carol-token' }
    });
    expect(accept.statusCode).toBe(409);
  });

  // 回归：唯一的约束该是"同一 (组织, 用户) 最多一条待处理邀请"，而不是"同终态只
  // 一条"。早先的 UNIQUE(org, username, status) 会让第二次终态翻转直接 500。
  it('allows inviting and declining the same user again', async () => {
    const db = initDatabase(dbPath);
    new PlatformSettingsRepository(db).setSetting('member_add_mode', 'invite');
    db.close();

    const invite = () =>
      app.inject({
        method: 'POST',
        url: '/api/orgs/acme/members',
        headers: aliceHeaders,
        payload: { username: 'carol' }
      });
    const carolToken = { authorization: 'token carol-token' };
    const myInvitations = async () =>
      (await app.inject({ method: 'GET', url: '/api/orgs/invitations', headers: carolToken })).json() as Array<{
        id: number;
      }>;

    await invite();
    const first = await myInvitations();
    const firstDecline = await app.inject({
      method: 'POST',
      url: `/api/orgs/invitations/${first[0].id}/decline`,
      headers: carolToken
    });
    expect(firstDecline.statusCode).toBe(200);

    await invite();
    const second = await myInvitations();
    expect(second[0].id).not.toBe(first[0].id);
    const secondDecline = await app.inject({
      method: 'POST',
      url: `/api/orgs/invitations/${second[0].id}/decline`,
      headers: carolToken
    });
    expect(secondDecline.statusCode).toBe(200);
    expect(await myInvitations()).toEqual([]);
  });

  it('allows withdrawing the same user invitation again', async () => {
    const db = initDatabase(dbPath);
    new PlatformSettingsRepository(db).setSetting('member_add_mode', 'invite');
    db.close();

    const inviteAndRevoke = async (): Promise<number> => {
      await app.inject({
        method: 'POST',
        url: '/api/orgs/acme/members',
        headers: aliceHeaders,
        payload: { username: 'carol' }
      });
      const pending = await app.inject({
        method: 'GET',
        url: '/api/orgs/acme/invitations',
        headers: aliceHeaders
      });
      const id = (pending.json() as Array<{ id: number }>)[0].id;
      const revoked = await app.inject({
        method: 'DELETE',
        url: `/api/orgs/acme/invitations/${id}`,
        headers: aliceHeaders
      });
      return revoked.statusCode;
    };

    expect(await inviteAndRevoke()).toBe(200);
    expect(await inviteAndRevoke()).toBe(200);
  });

  it('refuses to withdraw an invitation belonging to another organization', async () => {
    const db = initDatabase(dbPath);
    new PlatformSettingsRepository(db).setSetting('member_add_mode', 'invite');
    db.close();
    await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/members',
      headers: aliceHeaders,
      payload: { username: 'carol' }
    });
    const pending = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme/invitations',
      headers: aliceHeaders
    });
    const invitationId = (pending.json() as Array<{ id: number }>)[0].id;

    // outsider 不是 acme 的治理者，连路由守卫都过不去
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/acme/invitations/${invitationId}`,
      headers: { authorization: 'token outsider-token' }
    });

    expect(res.statusCode).toBe(403);
  });

  it('removing a member removes them from the org and every team', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme/members/bob',
      headers: aliceHeaders
    });

    expect(res.statusCode).toBe(200);
    expect(await gitea.listUserOrgs('bob')).toEqual([]);
    const teams = await gitea.listTeams('acme');
    for (const team of teams) {
      expect(await gitea.isTeamMember(team.id, 'bob')).toBe(false);
    }
  });

  it('any Owners member can manage members and teams', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/members',
      headers: { authorization: 'token co-token' },
      payload: { username: 'carol' }
    });
    expect(res.statusCode).toBe(201);
  });

  it('lists teams excluding Owners and standing teams, with preset display names', async () => {
    await gitea.createTeam('acme', 'frontend', 'read');
    const res = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme/teams',
      headers: aliceHeaders
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({ name: 'frontend', permission: 'read' })]);
    expect(JSON.stringify(res.json())).not.toContain('all-readers');
  });

  it('creates custom teams with an access level and guards standing team names', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/teams',
      headers: aliceHeaders,
      payload: { name: 'backend', permission: 'write' }
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ name: 'backend', permission: 'write' });

    const reserved = await app.inject({
      method: 'POST',
      url: '/api/orgs/acme/teams',
      headers: aliceHeaders,
      payload: { name: 'all-readers', permission: 'write' }
    });
    expect(reserved.statusCode).toBe(400);
  });

  it('refuses to delete or rename standing teams and Owners', async () => {
    for (const name of ['all-readers', 'all-writers', 'all-managers']) {
      const id = await teamId('acme', name);
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/orgs/acme/teams/${id}`,
        headers: aliceHeaders
      });
      expect(del.statusCode).toBe(400);

      const rename = await app.inject({
        method: 'PATCH',
        url: `/api/orgs/acme/teams/${id}`,
        headers: aliceHeaders,
        payload: { name: 'renamed' }
      });
      expect(rename.statusCode).toBe(400);
    }
    const ownersId = await teamId('acme', 'Owners');
    const delOwners = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/acme/teams/${ownersId}`,
      headers: aliceHeaders
    });
    expect(delOwners.statusCode).toBe(400);
  });

  it('edits and deletes custom teams by any Owners member', async () => {
    const created = await gitea.createTeam('acme', 'frontend', 'read');
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/acme/teams/${created.id}`,
      headers: aliceHeaders,
      payload: { name: 'review-crew', permission: 'write' }
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ name: 'review-crew', permission: 'write' });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/acme/teams/${created.id}`,
      headers: aliceHeaders
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: true });
  });

  it('grants and revokes team membership with global usernames', async () => {
    const created = await gitea.createTeam('acme', 'frontend', 'read');
    const add = await app.inject({
      method: 'POST',
      url: `/api/orgs/acme/teams/${created.id}/members`,
      headers: aliceHeaders,
      payload: { username: 'carol' }
    });
    expect(add.statusCode).toBe(201);
    expect(await gitea.isTeamMember(created.id, 'carol')).toBe(true);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/acme/teams/${created.id}/members/carol`,
      headers: aliceHeaders
    });
    expect(remove.statusCode).toBe(200);
    expect(await gitea.isTeamMember(created.id, 'carol')).toBe(false);
  });

  it('refuses to add a team member who has no platform account', async () => {
    const created = await gitea.createTeam('acme', 'frontend', 'read');
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/acme/teams/${created.id}/members`,
      headers: aliceHeaders,
      payload: { username: 'ghost' }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('ghost');
  });

  // 身份变更（ADR-0036）：提升 / 收回是成员列表上的一等动作，只有所有者成员能做。
  // 唯一的硬约束是"组织必须至少保留一名所有者成员"——自我降级、自我退出、被他人
  // 移出，三者同一条规则；"不能移除自己"已被取代。
  it('promotes a member to managing and to owner, then takes it back', async () => {
    const managingId = await teamId('acme', 'all-managers');
    const ownersId = await teamId('acme', 'Owners');

    const promote = await app.inject({
      method: 'PUT',
      url: '/api/orgs/acme/members/bob/identity',
      headers: aliceHeaders,
      payload: { identity: 'managing' }
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json()).toEqual({ username: 'bob', identity: 'managing' });
    expect(await gitea.isTeamMember(managingId!, 'bob')).toBe(true);
    expect(await gitea.isTeamMember(ownersId!, 'bob')).toBe(false);

    const toOwner = await app.inject({
      method: 'PUT',
      url: '/api/orgs/acme/members/bob/identity',
      headers: aliceHeaders,
      payload: { identity: 'owner' }
    });
    expect(toOwner.statusCode).toBe(200);
    expect(await gitea.isTeamMember(ownersId!, 'bob')).toBe(true);

    // 收回为普通成员：摘掉 Owners 与技能管理团队，只读/读写保留（三档是嵌套的）
    const demote = await app.inject({
      method: 'PUT',
      url: '/api/orgs/acme/members/bob/identity',
      headers: aliceHeaders,
      payload: { identity: 'ordinary' }
    });
    expect(demote.statusCode).toBe(200);
    expect(await gitea.isTeamMember(ownersId!, 'bob')).toBe(false);
    expect(await gitea.isTeamMember(managingId!, 'bob')).toBe(false);
    for (const name of ['all-readers', 'all-writers']) {
      const id = await teamId('acme', name);
      expect(await gitea.isTeamMember(id!, 'bob')).toBe(true);
    }
  });

  it('only lets owner members change identities', async () => {
    // bob 是普通成员：连路由守卫都过不去
    const res = await app.inject({
      method: 'PUT',
      url: '/api/orgs/acme/members/carol/identity',
      headers: { authorization: 'token bob-token' },
      payload: { identity: 'owner' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to change the identity of someone outside the organization', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/orgs/acme/members/carol/identity',
      headers: aliceHeaders,
      payload: { identity: 'managing' }
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an unknown identity value', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/orgs/acme/members/bob/identity',
      headers: aliceHeaders,
      payload: { identity: 'admin' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('lets an owner member remove another owner member from the organization', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme/members/co-admin',
      headers: aliceHeaders
    });

    expect(res.statusCode).toBe(200);
    expect(await gitea.listUserOrgs('co-admin')).toEqual([]);
  });

  it('lets an owner member leave the organization themselves', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme/members/admin-alice',
      headers: aliceHeaders
    });

    expect(res.statusCode).toBe(200);
    expect(await gitea.listUserOrgs('admin-alice')).toEqual([]);
  });

  it('keeps the last owner member from leaving or demoting themselves', async () => {
    // 先把 co-admin 移出，acme 只剩 admin-alice 一名所有者成员
    await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme/members/co-admin',
      headers: aliceHeaders
    });

    const leave = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/acme/members/admin-alice',
      headers: aliceHeaders
    });
    expect(leave.statusCode).toBe(400);
    expect(leave.json().error).toContain('last owner member');

    const demoteSelf = await app.inject({
      method: 'PUT',
      url: '/api/orgs/acme/members/admin-alice/identity',
      headers: aliceHeaders,
      payload: { identity: 'ordinary' }
    });
    expect(demoteSelf.statusCode).toBe(400);
    expect(demoteSelf.json().error).toContain('at least one owner member');

    const ownersId = await teamId('acme', 'Owners');
    expect(await gitea.isTeamMember(ownersId!, 'admin-alice')).toBe(true);
  });

  it('refuses to change identity through the generic team member endpoints', async () => {
    // 受保护团队（Owners 与三个常设团队）的成员增删是身份变更，不是团队授权——
    // 留着这条暗门就能绕过"至少保留一名所有者成员"（ADR-0036）
    for (const name of ['Owners', 'all-readers', 'all-managers']) {
      const id = await teamId('acme', name);
      const add = await app.inject({
        method: 'POST',
        url: `/api/orgs/acme/teams/${id}/members`,
        headers: aliceHeaders,
        payload: { username: 'carol' }
      });
      expect(add.statusCode).toBe(400);

      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/orgs/acme/teams/${id}/members/co-admin`,
        headers: aliceHeaders
      });
      expect(remove.statusCode).toBe(400);
    }
  });

  it('reports the three-tier identity in the member list', async () => {
    const managingId = await teamId('acme', 'all-managers');
    await gitea.addTeamMember(managingId!, 'bob');

    const res = await app.inject({
      method: 'GET',
      url: '/api/orgs/acme/members',
      headers: aliceHeaders
    });

    expect(res.statusCode).toBe(200);
    const byName = new Map(
      (res.json() as Array<{ username: string; identity: string }>).map((member) => [
        member.username,
        member.identity
      ])
    );
    expect(byName.get('admin-alice')).toBe('owner');
    expect(byName.get('co-admin')).toBe('owner');
    expect(byName.get('bob')).toBe('managing');
  });
});
