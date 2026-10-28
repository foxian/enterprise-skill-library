import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 技能关键词展示（#142）：关键词取最新一次 Skill Release 快照，与 search 的
// 匹配口径一致——历史 Release 已移除的关键词不得继续展示；没有关键词时返回
// 空数组，而不是缺字段，Web 侧据此不渲染空容器。
describe('skill keywords', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-keywords-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [{ username: 'alice', password: 'alice-password' }],
      orgs: [{ name: 'acme', teams: [] }]
    });

    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    createPublishedSkill(repository, {
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      description: 'Org tool',
      releases: [
        { version: '1.0.0', keywords: ['Legacy', 'Code Review'] },
        { version: '1.1.0', keywords: ['Code Review', 'review'] }
      ]
    });
    createPublishedSkill(repository, {
      name: '@acme/plain',
      scope: 'acme',
      skillName: 'plain',
      description: 'No keywords',
      releases: [{ version: '1.0.0', keywords: [] }]
    });
    createPublishedSkill(repository, {
      name: '@acme/preview',
      scope: 'acme',
      skillName: 'preview',
      description: 'Prerelease keywords',
      releases: [
        { version: '1.0.0', keywords: ['stable'] },
        { version: '2.0.0-beta.1', keywords: ['beta'] }
      ]
    });
    db.close();
    app = await buildApp({ dbPath, giteaService: gitea as never, repoOwner: 'esl-skills' });
    gitea.validateToken.mockImplementation(async (token: string) => {
      const map: Record<string, string> = { 'alice-token': 'alice' };
      const username = map[token];
      return username ? { id: 1, username, email: `${username}@local.esl` } : null;
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('详情响应返回最新 Release 快照的关键词，保留原始文本并丢弃历史关键词', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/tool',
      headers: { authorization: 'token alice-token' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().keywords).toEqual(['Code Review', 'review']);
  });

  it('没有关键词时返回空数组', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/plain',
      headers: { authorization: 'token alice-token' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().keywords).toEqual([]);
  });

  it('预发布是最新 Release 时，关键词同样取预发布快照', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/preview',
      headers: { authorization: 'token alice-token' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().keywords).toEqual(['beta']);
  });

  it('技能管理上下文的 permissions 响应携带同一份关键词', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/acme/tool/permissions',
      headers: { authorization: 'token alice-token' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().skill.keywords).toEqual(['Code Review', 'review']);
  });
});

interface SeedRelease {
  version: string;
  keywords: string[];
}

function createPublishedSkill(
  repository: SkillRepository,
  seed: {
    name: string;
    scope: string;
    skillName: string;
    description: string;
    releases: SeedRelease[];
  }
): void {
  repository.createServerSkill({
    name: seed.name,
    scope: seed.scope,
    skillName: seed.skillName,
    description: seed.description,
    createdBy: 'alice',
    owner: 'alice',
    maintainers: ['alice'],
    visibility: 'public',
    gitRepoPath: `${seed.scope}/${seed.skillName}`,
    status: 'active-published'
  });
  const skill = repository.getSkill(seed.name)!;
  for (const release of seed.releases) {
    repository.createRelease({
      skillId: skill.skillId!,
      skillName: seed.name,
      version: release.version,
      sourceCommit: 'abc123',
      packagePath: `packages/${seed.skillName}-${release.version}.tgz`,
      checksum: `checksum-${release.version}`,
      releaseManifest: {
        schemaVersion: 3,
        name: seed.name,
        version: release.version,
        license: 'MIT',
        keywords: release.keywords,
        compatibility: {},
        dependencies: {}
      },
      dependencyLock: {},
      createdBy: 'alice'
    });
  }
}
