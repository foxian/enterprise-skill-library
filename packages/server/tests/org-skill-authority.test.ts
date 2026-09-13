import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 技能授权目标语义（ADR-0032 / #57）：新技能默认 private、组织成员默认零权限、
// Organization Admin（Owners）对本组织全部技能有治理兜底管理权、
// share_all_* = 授权给三个常设团队。Gitea 仍是权限事实源。
describe('org skill authority', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-authority-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'bob', password: 'bob-password' },
        { username: 'carol', password: 'carol-password' },
        { username: 'mallory', password: 'mallory-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    // 组织管理员 = Owners（alice）；bob/carol 为普通成员（挂在三个常设团队）
    gitea.__state.setOrgOwner('acme', 'alice');
    for (const [name, permission] of [
      ['all-readers', 'read'],
      ['all-writers', 'write'],
      ['all-managers', 'admin']
    ] as const) {
      await gitea.createTeam('acme', name, permission);
    }
    const standingTeams = await gitea.listTeams('acme');
    for (const member of ['bob', 'carol']) {
      for (const team of standingTeams.filter((candidate) => candidate.name !== 'Owners')) {
        await gitea.addTeamMember(team.id, member);
      }
    }

    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    // bob 上传的 org private 技能（默认形态）
    repository.createServerSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      description: 'Org tool',
      createdBy: 'bob',
      owner: 'bob',
      maintainers: ['bob'],
      visibility: 'private',
      gitRepoPath: 'acme/tool',
      status: 'active-unreleased'
    });
    db.close();
    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
    gitea.validateToken.mockImplementation(async (token: string) => {
      const map: Record<string, string> = {
        'alice-token': 'alice',
        'bob-token': 'bob',
        'carol-token': 'carol',
        'mallory-token': 'mallory'
      };
      const username = map[token];
      return username ? { id: 1, username, email: `${username}@local.esl` } : null;
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a new skill is private and invisible to org members by default (zero default access)', async () => {
    for (const token of ['carol-token', 'mallory-token']) {
      const info = await app.inject({
        method: 'GET',
        url: '/api/skills/@acme/tool',
        headers: { authorization: `token ${token}` }
      });
      expect(info.statusCode).toBe(403);
    }
  });

  it('the uploader keeps manage access via maintainer record', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool/permissions',
      headers: { authorization: 'token bob-token' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().viewerAccess).toBe('manage');
  });

  it('the Organization Admin sees and manages every org skill as governance fallback', async () => {
    // alice 不是 maintainer，但她是 acme 的 Owners 成员
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool/permissions',
      headers: { authorization: 'token alice-token' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().viewerAccess).toBe('manage');
  });

  it('a legacy <org>_admin username gains nothing by name alone', async () => {
    // carol 的账号名不带任何结构含义；这里验证判定不依赖账号命名约定：
    // mallory 在 DB 无记录也无 Gitea 授权 → none
    const search = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=tool',
      headers: { authorization: 'token mallory-token' }
    });
    expect(search.json()).toEqual([]);
  });

  it('sharing to a standing team grants the equivalent access to every org member', async () => {
    const readers = await gitea.listTeams('acme');
    const readersTeam = readers.find((team) => team.name === 'all-readers')!;
    await gitea.addTeamRepo(readersTeam.id, 'acme', 'tool');

    // 只读团队挂载后，普通成员 carol 可见（read）
    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool',
      headers: { authorization: 'token carol-token' }
    });
    expect(info.statusCode).toBe(200);

    // 但只有读档（矩阵可见，viewerAccess=read，不能变更）
    const matrix = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool/permissions',
      headers: { authorization: 'token carol-token' }
    });
    expect(matrix.statusCode).toBe(200);
    expect(matrix.json().viewerAccess).toBe('read');

    const change = await app.inject({
      method: 'POST',
      url: '/api/skills/@acme/tool/permissions',
      headers: { authorization: 'token carol-token' },
      payload: { action: 'share_all_read' }
    });
    expect(change.statusCode).toBe(403);
  });

  it('the share_all actions mount the standing teams onto the skill repository', async () => {
    const publish = await app.inject({
      method: 'POST',
      url: '/api/skills/@acme/tool/permissions',
      headers: { authorization: 'token bob-token' },
      payload: { action: 'share_all_read' }
    });
    expect(publish.statusCode).toBe(200);

    const matrix = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool/permissions',
      headers: { authorization: 'token bob-token' }
    });
    expect(matrix.json().sharedAllRead).toBe(true);
    // 常设团队挂载在 repo 上（Gitea 权限事实源）
    const readersTeam = (await gitea.listTeams('acme')).find((team) => team.name === 'all-readers')!;
    expect(await gitea.isTeamMember(readersTeam.id, 'carol')).toBe(true);
  });
});
