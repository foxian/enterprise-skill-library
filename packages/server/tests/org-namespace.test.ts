import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 组织命名空间发布链（ADR-0032 / #56）：name = @org/skill 时校验成员身份、
// 在组织名下建仓、上传者成为初始 Maintainer；publish 断言身份一致。
describe('organization namespace publish', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-ns-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'bob', password: 'bob-password' },
        { username: 'mallory', password: 'mallory-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.setOrgOwner('acme', 'alice');
    gitea.__state.addOrgMember('acme', 'alice');
    gitea.__state.addOrgMember('acme', 'bob');

    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    db.close();
    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
    gitea.validateToken.mockImplementation(async (token: string) => {
      const map: Record<string, string> = {
        'alice-token': 'alice',
        'bob-token': 'bob',
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

  const upload = (token: string, name: string, description = 'A skill') =>
    app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: `token ${token}` },
      payload: { name, description }
    });

  it('any org member can upload a new skill into the org namespace without pre-authorization', async () => {
    const res = await upload('bob-token', '@acme/tool');

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      createdBy: 'bob',
      maintainers: ['bob']
    });
    // 组织技能 = 组织仓库
    expect(gitea.createRepo).toHaveBeenCalledWith('acme', 'tool', true);
    // 创建者（普通成员）必须在 Gitea 层获得来源仓库访问权，否则首次 push 被拒
    expect(gitea.addCollaborator).toHaveBeenCalledWith('acme', 'tool', 'bob', 'admin');
    expect(await gitea.getCollaboratorPermission('acme', 'tool', 'bob')).toBe('admin');
  });

  it('re-grants creator Git access when resuming an interrupted first upload', async () => {
    const first = await upload('bob-token', '@acme/tool');
    expect(first.statusCode).toBe(201);
    // 模拟修复前注册的无授权来源：清掉创建者的协作者授权后断点续传
    await gitea.removeCollaborator('acme', 'tool', 'bob');
    gitea.addCollaborator.mockClear();
    gitea.createRepo.mockClear();

    const retry = await upload('bob-token', '@acme/tool');
    expect(retry.statusCode).toBe(200);
    expect(gitea.createRepo).not.toHaveBeenCalled();
    expect(gitea.addCollaborator).toHaveBeenCalledWith('acme', 'tool', 'bob', 'admin');
  });

  it('cleans up the orphan repository when the creator Git grant fails', async () => {
    gitea.addCollaborator.mockRejectedValueOnce(new Error('gitea unavailable'));

    const res = await upload('bob-token', '@acme/broken');
    expect(res.statusCode).toBe(500);
    expect(gitea.deleteRepo).toHaveBeenCalledWith('acme', 'broken');
    expect(gitea.__state.repos.has('acme/broken')).toBe(false);
  });

  it('non-members are rejected with a membership-specific error', async () => {
    const res = await upload('mallory-token', '@acme/jacked');

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('member');
    expect(res.json().error).toContain('acme');
    expect(gitea.createRepo).not.toHaveBeenCalledWith('acme', 'jacked', true);
  });

  it('publishes a release when the manifest name matches the org identity', async () => {
    await upload('bob-token', '@acme/tool');
    const manifest = {
      schemaVersion: 3,
      name: '@acme/tool',
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    };
    gitea.readSourceTree.mockResolvedValue({
      'SKILL.md': '---\nname: tool\n---\n',
      'release.json': JSON.stringify(manifest)
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/skills/@acme/tool/releases',
      headers: { authorization: 'token bob-token' },
      payload: { version: '1.0.0', sourceCommit: 'abc123', releaseManifest: manifest }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: '1.0.0', skillId: expect.stringMatching(/^sk_/) });

    // 已发布技能可被检索到（组织成员有读权限）
    const search = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=tool',
      headers: { authorization: 'token bob-token' }
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual([expect.objectContaining({ name: '@acme/tool' })]);
  });

  it('refuses a publish whose manifest name points at another namespace', async () => {
    await upload('bob-token', '@acme/tool');
    const manifest = {
      schemaVersion: 3,
      name: '@acme/renamed',
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/skills/@acme/tool/releases',
      headers: { authorization: 'token bob-token' },
      payload: { version: '1.0.0', sourceCommit: 'abc123', releaseManifest: manifest }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('@acme/tool');
  });

  it('keeps the resume path for an interrupted first upload by the same creator', async () => {
    const first = await upload('bob-token', '@acme/tool');
    expect(first.statusCode).toBe(201);
    const skillId = first.json().skillId;

    const retry = await upload('bob-token', '@acme/tool');
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ skillId });
    expect(gitea.createRepo).toHaveBeenCalledTimes(1);
  });

  it('records the skill in the platform registry under the org scope', async () => {
    await upload('alice-token', '@acme/inspector');

    const db = initDatabase(dbPath);
    const skill = new SkillRepository(db).getSkill('@acme/inspector');
    db.close();
    expect(skill).toMatchObject({
      scope: 'acme',
      skillName: 'inspector',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      gitRepoPath: 'acme/inspector'
    });
  });
});
