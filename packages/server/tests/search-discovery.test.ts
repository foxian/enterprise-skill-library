import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 可安装技能发现面（ADR-0049 / #73）：search 匿名可浏览 public 已发布技能，
// 登录后附加有权的 private；结果由服务端一次 enrich（显示名、最新正式版、
// visibility），未发布技能不出现在结果里。
describe('skill search discovery', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-search-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'zoe', password: 'zoe-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }, { name: 'beta', teams: [] }]
    });

    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    new TenantOrganizationRepository(db).create({ orgName: 'beta', status: 'active' });
    createPublishedSkill(repository, {
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      description: 'Org tool',
      visibility: 'public',
      releases: [
        { version: '1.0.0', keywords: ['code-review', 'review'] },
        { version: '2.0.0-beta.1', keywords: ['code-review', 'review'] }
      ]
    });
    createPublishedSkill(repository, {
      name: '@acme/notes',
      scope: 'acme',
      skillName: 'notes',
      description: 'Private notes skill',
      visibility: 'private',
      releases: [
        { version: '0.1.0', keywords: ['legacy'] },
        { version: '0.2.0', keywords: ['notes'] }
      ]
    });
    createPublishedSkill(repository, {
      name: '@beta/lib',
      scope: 'beta',
      skillName: 'lib',
      description: 'Beta library',
      visibility: 'public',
      releases: [{ version: '1.2.0', keywords: ['library'] }]
    });
    createPublishedSkill(repository, {
      name: '@acme/friendly',
      scope: 'acme',
      skillName: 'friendly',
      description: 'Source upload helper',
      visibility: 'public',
      releases: [{ version: '1.0.0', keywords: [], displayName: 'Markdown Master' }]
    });
    repository.createServerSkill({
      name: '@acme/draft',
      scope: 'acme',
      skillName: 'draft',
      description: 'Unpublished draft',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'public',
      gitRepoPath: 'acme/draft',
      status: 'active-unreleased'
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

  it('anonymous browse returns public published skills with enriched fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/skills/search' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        name: '@acme/tool',
        scope: 'acme',
        skillName: 'tool',
        description: 'Org tool',
        displayName: 'tool',
        latestStableVersion: '1.0.0',
        visibility: 'public'
      }),
      expect.objectContaining({ name: '@beta/lib', latestStableVersion: '1.2.0' }),
      expect.objectContaining({ name: '@acme/friendly', displayName: 'Markdown Master' })
    ]);
  });

  it('a logged-in user additionally sees private skills they can read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/search',
      headers: { authorization: 'token alice-token' }
    });

    const names = (res.json() as Array<{ name: string }>).map((skill) => skill.name);
    expect(names).toContain('@acme/notes');
  });

  it('an unrelated user does not see private skills', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/search',
      headers: { authorization: 'token zoe-token' }
    });

    const names = (res.json() as Array<{ name: string }>).map((skill) => skill.name);
    expect(names).not.toContain('@acme/notes');
  });

  it('query matches identity, description, display name, and keywords', async () => {
    const byDisplayName = await app.inject({ method: 'GET', url: '/api/skills/search?q=markdown' });
    expect((byDisplayName.json() as Array<{ name: string }>).map((s) => s.name)).toEqual(['@acme/friendly']);

    const byKeyword = await app.inject({ method: 'GET', url: '/api/skills/search?q=code-review' });
    expect((byKeyword.json() as Array<{ name: string }>).map((s) => s.name)).toEqual(['@acme/tool']);

    const byIdentity = await app.inject({ method: 'GET', url: '/api/skills/search?q=@beta/lib' });
    expect((byIdentity.json() as Array<{ name: string }>).map((s) => s.name)).toEqual(['@beta/lib']);
  });

  it('filters by namespace, keyword, visibility, and limit', async () => {
    const byNamespace = await app.inject({ method: 'GET', url: '/api/skills/search?namespace=beta' });
    expect((byNamespace.json() as Array<{ name: string }>).map((s) => s.name)).toEqual(['@beta/lib']);

    const byKeyword = await app.inject({ method: 'GET', url: '/api/skills/search?keyword=library' });
    expect((byKeyword.json() as Array<{ name: string }>).map((s) => s.name)).toEqual(['@beta/lib']);

    const removedKeyword = await app.inject({
      method: 'GET',
      url: '/api/skills/search?keyword=legacy',
      headers: { authorization: 'token alice-token' }
    });
    expect((removedKeyword.json() as Array<{ name: string }>).map((s) => s.name)).toEqual([]);

    const publicOnly = await app.inject({
      method: 'GET',
      url: '/api/skills/search?visibility=public',
      headers: { authorization: 'token alice-token' }
    });
    const publicNames = (publicOnly.json() as Array<{ name: string }>).map((s) => s.name);
    expect(publicNames).not.toContain('@acme/notes');

    const privateOnly = await app.inject({
      method: 'GET',
      url: '/api/skills/search?visibility=private',
      headers: { authorization: 'token alice-token' }
    });
    expect((privateOnly.json() as Array<{ name: string }>).map((s) => s.name)).toEqual(['@acme/notes']);

    const limited = await app.inject({ method: 'GET', url: '/api/skills/search?limit=1' });
    expect((limited.json() as unknown[]).length).toBe(1);
  });

  it('rejects anonymous private browsing with an explicit unauthorized error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/skills/search?visibility=private' });

    expect(res.statusCode).toBe(401);
  });
});

interface SeedRelease {
  version: string;
  keywords: string[];
  displayName?: string;
}

function createPublishedSkill(
  repository: SkillRepository,
  seed: {
    name: string;
    scope: string;
    skillName: string;
    description: string;
    visibility: string;
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
    visibility: seed.visibility,
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
        ...(release.displayName ? { displayName: release.displayName } : {}),
        compatibility: {},
        dependencies: {}
      },
      dependencyLock: {},
      createdBy: 'alice'
    });
  }
}
