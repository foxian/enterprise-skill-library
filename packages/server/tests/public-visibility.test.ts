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
      expect.objectContaining({ name: '@acme/tool', access: 'read', relation: 'shared' })
    ]);

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool',
      headers: { authorization: 'token zoe-token' }
    });
    expect(info.statusCode).toBe(200);
  });

  it('a private skill stays invisible to unrelated users with a clear no-access error', async () => {
    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool',
      headers: { authorization: 'token zoe-token' }
    });
    expect(info.statusCode).toBe(403);
    expect(info.json().message).toContain('private');
  });
});
