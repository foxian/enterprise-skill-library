import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 技能可见性（ADR-0032 / #58）：public = 平台全员可搜可装可作依赖；
// private = 仅 Maintainer 与被授权者；search/inventory 按可见性过滤，
// 不再按调用者组织隔离。
describe('skill visibility', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-visibility-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'zoe', password: 'zoe-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.setOrgOwner('acme', 'alice');

    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    repository.createServerSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      description: 'Org tool',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'acme/tool',
      status: 'active-published'
    });
    // 消费详情的三态夹具（ADR-0076）：已归档技能不再可消费，与不存在同形。
    repository.createServerSkill({
      name: '@acme/old',
      scope: 'acme',
      skillName: 'old',
      description: 'Archived org tool',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'acme/old',
      status: 'archived'
    });
    // search（ADR-0049）只返回有 Skill Release 的技能；给夹具补发布记录。
    const tool = repository.getSkill('@acme/tool')!;
    repository.createRelease({
      skillId: tool.skillId!,
      skillName: '@acme/tool',
      version: '1.0.0',
      sourceCommit: 'abc123',
      packagePath: 'packages/tool-1.0.0.tgz',
      checksum: 'checksum-tool',
      releaseManifest: {
        schemaVersion: 3,
        name: '@acme/tool',
        version: '1.0.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      },
      dependencyLock: {},
      createdBy: 'alice'
    });
    db.close();
    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
    gitea.validateToken.mockImplementation(async (token: string) => {
      const map: Record<string, string> = { 'alice-token': 'alice', 'zoe-token': 'zoe' };
      const username = map[token];
      return username ? { id: 1, username, email: `${username}@local.esl` } : null;
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('the maintainer can switch a skill to public', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/skills/@acme/tool/visibility',
      headers: { authorization: 'token alice-token' },
      payload: { visibility: 'public' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: '@acme/tool', visibility: 'public' });

    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@acme/tool')?.visibility).toBe('public');
    db.close();
  });

  it('non-maintainers cannot switch visibility', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/skills/@acme/tool/visibility',
      headers: { authorization: 'token zoe-token' },
      payload: { visibility: 'public' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('a public skill shows up in any user search and inventory across namespaces', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/skills/@acme/tool/visibility',
      headers: { authorization: 'token alice-token' },
      payload: { visibility: 'public' }
    });

    const search = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=tool',
      headers: { authorization: 'token zoe-token' }
    });
    expect(search.json()).toEqual([expect.objectContaining({ name: '@acme/tool' })]);

    const inventory = await app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token zoe-token' }
    });
    expect(inventory.json()).toEqual([
      expect.objectContaining({ name: '@acme/tool', description: 'Org tool', access: 'read', relation: 'shared' })
    ]);

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool',
      headers: { authorization: 'token zoe-token' }
    });
    expect(info.statusCode).toBe(200);
  });

  it('已登录消费主体对不存在 / 无权 private / 已归档得到完全相同的响应', async () => {
    const detail = (token: string, name: string) =>
      app.inject({
        method: 'GET',
        url: `/api/skills/${name}`,
        headers: { authorization: `token ${token}` }
      });

    const missing = await detail('zoe-token', '@acme/missing');
    const unauthorized = await detail('zoe-token', '@acme/tool');
    const archived = await detail('zoe-token', '@acme/old');

    // ADR-0076：三种不可用状态在 HTTP 边界完全不可区分。
    expect(missing.statusCode).toBe(404);
    expect(unauthorized.statusCode).toBe(missing.statusCode);
    expect(archived.statusCode).toBe(missing.statusCode);
    expect(unauthorized.body).toBe(missing.body);
    expect(archived.body).toBe(missing.body);
    expect(archived.body).not.toContain('@acme/old');
  });

  it('归档技能对维护者的消费详情同样按不可用处理', async () => {
    const archived = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/old',
      headers: { authorization: 'token alice-token' }
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/missing',
      headers: { authorization: 'token alice-token' }
    });

    expect(archived.statusCode).toBe(404);
    expect(archived.body).toBe(missing.body);
  });

  it('维护者经管理向权限端点仍可查看已归档技能', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/old/permissions',
      headers: { authorization: 'token alice-token' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ skill: { name: '@acme/old', status: 'archived' } });
    expect(res.json().viewerAccess).toBe('manage');
  });

  it('匿名访问 private 仍需登录，访问已归档技能按不存在处理', async () => {
    const privateSkill = await app.inject({ method: 'GET', url: '/api/skills/@acme/tool' });
    expect(privateSkill.statusCode).toBe(401);

    const archived = await app.inject({ method: 'GET', url: '/api/skills/@acme/old' });
    const missing = await app.inject({ method: 'GET', url: '/api/skills/@acme/missing' });
    expect(archived.statusCode).toBe(404);
    expect(archived.body).toBe(missing.body);
  });

  it('授权维护者读取 private 详情仍返回完整 DTO 与安装命令所需字段', async () => {
    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool',
      headers: { authorization: 'token alice-token' }
    });

    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({
      name: '@acme/tool',
      visibility: 'private'
    });
    expect(info.json().releases).toEqual([expect.objectContaining({ version: '1.0.0' })]);
    expect(typeof info.json().packageUrl).toBe('string');
  });
});
