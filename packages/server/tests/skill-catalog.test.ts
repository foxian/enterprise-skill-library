import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  DownloadLogRepository,
  initDatabase,
  SkillRepository,
  TenantOrganizationRepository
} from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 技能目录（#199 / spec #200，本票 #202）：登录主体经鉴权 API 取得「我此刻有权
// 安装消费的全部已发布技能」全集；匿名被拒；越权 / 未发布 / 已归档 / 冻结组织技能
// 一律不出现；权限按请求时刻实时判定。
describe('skill catalog', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  const tokenNames: Record<string, string> = {
    'alice-token': 'alice',
    'zoe-token': 'zoe',
    'olga-token': 'olga',
    'bob-token': 'bob'
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-catalog-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'zoe', password: 'zoe-password' },
        { username: 'olga', password: 'olga-password' },
        { username: 'bob', password: 'bob-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }, { name: 'beta', teams: [] }]
    });
    // acme / beta 的所有者都是 olga；alice 是两个组织的普通成员；zoe 没有任何组织。
    gitea.__state.setOrgOwner('acme', 'olga');
    gitea.__state.setOrgOwner('beta', 'olga');
    gitea.__state.addOrgMember('acme', 'alice');
    gitea.__state.addOrgMember('beta', 'alice');
    // 真实 Gitea 对个人仓库的团队列表返回「仓库不属于组织」，服务层视作没有团队；
    // 夹具按同一语义覆盖，使个人 private 技能的授权只经协作者判定。
    gitea.listRepoTeams.mockImplementation(async () => []);

    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    const tenants = new TenantOrganizationRepository(db);
    tenants.create({ orgName: 'acme', status: 'active' });
    tenants.create({ orgName: 'beta', status: 'active' });
    tenants.create({ orgName: 'draining', status: 'deleting' });

    seedSkill(repository, {
      name: '@acme/tool',
      visibility: 'public',
      description: 'Org tool',
      releases: [{ version: '1.0.0', keywords: ['code-review'], displayName: 'Acme Tool' }]
    });
    seedSkill(repository, {
      name: '@acme/notes',
      visibility: 'private',
      description: 'Private notes'
    });
    seedSkill(repository, {
      name: '@beta/lib',
      visibility: 'public',
      description: 'Beta library'
    });
    seedSkill(repository, {
      name: '@beta/open',
      visibility: 'anonymous',
      description: 'Anonymous open skill'
    });
    seedSkill(repository, {
      name: '@bob/secret',
      visibility: 'private',
      description: 'Bob private skill',
      owner: 'bob'
    });
    seedSkill(repository, {
      name: '@alice/mine',
      visibility: 'private',
      description: 'My own private skill',
      owner: 'alice'
    });
    seedSkill(repository, {
      name: '@alice/pub',
      visibility: 'public',
      description: 'My own public skill',
      owner: 'alice'
    });
    // 冻结/删除中的组织命名空间：其技能不得进入目录（与 /api/skills/* 的组织激活门禁对齐）。
    seedSkill(repository, {
      name: '@draining/legacy',
      visibility: 'public',
      description: 'Legacy skill of a deleting organization'
    });
    // 未发布（没有任何 Skill Release）与已归档技能都不可安装。
    seedSkill(repository, {
      name: '@acme/draft',
      visibility: 'public',
      description: 'Unpublished draft',
      status: 'active-unreleased',
      releases: []
    });
    seedSkill(repository, {
      name: '@beta/old',
      visibility: 'public',
      description: 'Archived skill',
      status: 'archived'
    });

    const tool = repository.getSkill('@acme/tool')!;
    const downloads = new DownloadLogRepository(db);
    for (const version of ['1.0.0', '1.0.0']) {
      downloads.record({
        skillId: tool.skillId!,
        skillIdentity: tool.name,
        version,
        result: 'success'
      });
    }
    db.close();

    // acme/notes 是组织 private：alice 经成员角色之外的技能成员授权（协作者）；
    // bob/secret 是他人个人 private：直接授权给 alice。zoe 两者都没有。
    await gitea.addCollaborator('acme', 'notes', 'alice', 'read');
    await gitea.addCollaborator('bob', 'secret', 'alice', 'read');

    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
    gitea.validateToken.mockImplementation(async (token: string) => {
      const username = tokenNames[token];
      return username ? { id: 1, username, email: `${username}@local.esl` } : null;
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function catalog(token?: string) {
    return app.inject({
      method: 'GET',
      url: '/api/catalog/skills',
      ...(token ? { headers: { authorization: `token ${token}` } } : {})
    });
  }

  function identities(response: { json: () => unknown }): string[] {
    return (response.json() as Array<{ identity: string }>).map((entry) => entry.identity).sort();
  }

  it('rejects anonymous callers', async () => {
    const res = await catalog();
    expect(res.statusCode).toBe(401);
  });

  it('returns the full installable set of a multi-organization member with ownership fields', async () => {
    const res = await catalog('alice-token');
    expect(res.statusCode).toBe(200);

    expect(identities(res)).toEqual(
      [
        '@acme/tool',
        '@acme/notes',
        '@beta/lib',
        '@beta/open',
        '@bob/secret',
        '@alice/mine',
        '@alice/pub'
      ].sort()
    );

    const entries = res.json() as Array<Record<string, unknown>>;
    const tool = entries.find((entry) => entry.identity === '@acme/tool')!;
    expect(tool).toMatchObject({
      identity: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      displayName: 'Acme Tool',
      description: 'Org tool',
      latestStableVersion: '1.0.0',
      visibility: 'public',
      downloadCount: 2,
      namespaceKind: 'organization',
      namespaceName: 'acme'
    });
    expect(entries.find((entry) => entry.identity === '@bob/secret')).toMatchObject({
      visibility: 'private',
      namespaceKind: 'personal',
      namespaceName: 'bob'
    });
  });

  it('gives a user without organizations only the public and anonymous set', async () => {
    const res = await catalog('zoe-token');
    expect(res.statusCode).toBe(200);

    expect(identities(res)).toEqual(
      ['@acme/tool', '@beta/lib', '@beta/open', '@alice/pub'].sort()
    );
    const entries = res.json() as Array<Record<string, unknown>>;
    expect(entries.find((entry) => entry.identity === '@alice/pub')).toMatchObject({
      visibility: 'public',
      namespaceKind: 'personal',
      namespaceName: 'alice'
    });
  });

  it('keeps unpublished, archived, and deleting-organization skills out of the catalog', async () => {
    const res = await catalog('alice-token');
    const names = identities(res);

    expect(names).not.toContain('@acme/draft');
    expect(names).not.toContain('@beta/old');
    expect(names).not.toContain('@draining/legacy');
    expect(names).toContain('@acme/tool');
  });

  it('re-evaluates private read access at request time', async () => {
    expect(identities(await catalog('zoe-token'))).not.toContain('@acme/notes');

    await gitea.addCollaborator('acme', 'notes', 'zoe', 'read');
    expect(identities(await catalog('zoe-token'))).toContain('@acme/notes');

    await gitea.removeCollaborator('acme', 'notes', 'zoe');
    expect(identities(await catalog('zoe-token'))).not.toContain('@acme/notes');
  });

  it('excludes only the entry whose permission lookup fails instead of failing the request', async () => {
    const fallback = gitea.getCollaboratorPermission.getMockImplementation()!;
    gitea.getCollaboratorPermission.mockImplementation(async (owner, repo, username) => {
      if (repo === 'notes') throw new Error('git backend unavailable');
      return fallback(owner, repo, username);
    });

    const res = await catalog('alice-token');
    expect(res.statusCode).toBe(200);
    const names = identities(res);
    expect(names).not.toContain('@acme/notes');
    expect(names).toContain('@bob/secret');
  });

  it('keeps the public search response contract unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/skills/search' });
    expect(res.statusCode).toBe(200);
    const entries = res.json() as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.name)).toEqual(['@beta/open']);
    expect(Object.keys(entries[0]!).sort()).toEqual([
      'description',
      'displayName',
      'downloadCount',
      'latestStableVersion',
      'name',
      'scope',
      'skillName',
      'visibility'
    ]);
  });
});

interface SeedSkill {
  name: string;
  visibility: string;
  description: string;
  owner?: string;
  status?: string;
  releases?: Array<{ version: string; keywords?: string[]; displayName?: string }>;
}

function seedSkill(repository: SkillRepository, seed: SeedSkill): void {
  const scope = seed.name.slice(1, seed.name.indexOf('/'));
  const skillName = seed.name.slice(seed.name.indexOf('/') + 1);
  const owner = seed.owner ?? 'olga';
  repository.createServerSkill({
    name: seed.name,
    scope,
    skillName,
    description: seed.description,
    createdBy: owner,
    owner,
    maintainers: [owner],
    visibility: seed.visibility,
    gitRepoPath: `${scope}/${skillName}`,
    status: seed.status ?? 'active-published'
  });
  const skill = repository.getSkill(seed.name)!;
  for (const release of seed.releases ?? [{ version: '1.0.0' }]) {
    repository.createRelease({
      skillId: skill.skillId!,
      skillName: seed.name,
      version: release.version,
      sourceCommit: 'abc123',
      packagePath: `packages/${skillName}-${release.version}.tgz`,
      checksum: `checksum-${release.version}`,
      releaseManifest: {
        schemaVersion: 3,
        name: seed.name,
        version: release.version,
        license: 'MIT',
        keywords: release.keywords ?? [],
        ...(release.displayName ? { displayName: release.displayName } : {}),
        compatibility: {},
        dependencies: {}
      },
      dependencyLock: {},
      createdBy: owner
    });
  }
}
