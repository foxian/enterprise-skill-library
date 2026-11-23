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
import { createLogCapture, recordsForEvent } from './helpers/log-capture.js';

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

  async function catalog(token?: string, query: Record<string, string> = {}) {
    const search = new URLSearchParams(query).toString();
    return app.inject({
      method: 'GET',
      url: `/api/catalog/skills${search ? `?${search}` : ''}`,
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
    expect(identities(await catalog('zoe-token'))).not.toContain('@bob/secret');

    await gitea.addCollaborator('bob', 'secret', 'zoe', 'read');
    expect(identities(await catalog('zoe-token'))).toContain('@bob/secret');

    await gitea.removeCollaborator('bob', 'secret', 'zoe');
    expect(identities(await catalog('zoe-token'))).not.toContain('@bob/secret');
  });

  it('fails closed when an organization private skill is readable outside the caller organizations', async () => {
    // zoe 是 acme/notes 的直接协作者，但不是 acme 成员：可读性成立，归桶不变量不成立
    // （技术核查 §1.3.4）。目录必须排除，不得猜成 granted。
    await gitea.addCollaborator('acme', 'notes', 'zoe', 'read');

    expect(identities(await catalog('zoe-token'))).not.toContain('@acme/notes');
    expect(identities(await catalog('zoe-token', { q: 'notes' }))).toEqual([]);

    // 公开搜索不解析组织集合（resolveOrganizationScopes=false），行为保持不变：
    // 仍然按请求时刻读权限返回该技能。
    const search = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=notes',
      headers: { authorization: 'token zoe-token' }
    });
    expect(search.statusCode).toBe(200);
    expect((search.json() as Array<{ name: string }>).map((entry) => entry.name)).toContain(
      '@acme/notes'
    );
  });

  it('logs a diagnostic instead of silently guessing a bucket for the excluded entry', async () => {
    await gitea.addCollaborator('acme', 'notes', 'zoe', 'read');
    await app.close();
    const capture = createLogCapture();
    app = await buildApp({
      dbPath,
      giteaService: gitea as any,
      repoOwner: 'esl-skills',
      logger: capture.logger
    });

    expect((await catalog('zoe-token')).statusCode).toBe(200);

    const [warning] = recordsForEvent(capture, 'skill.catalog.organization-private-outside-scope');
    expect(warning).toMatchObject({
      level: 40,
      actorUsername: 'zoe',
      organization: 'acme',
      resourceType: 'skill',
      resourceId: '@acme/notes'
    });
  });

  it('does not apply the organization activation gate to the catalog collection route', async () => {
    // 组织名恰好叫 skills 且处于删除中：门禁不能把 /api/catalog/skills 的路径段当成
    // 技能命名空间。目录服务层已按 inactive 组织过滤，端点本身必须可访问。
    const db = initDatabase(dbPath);
    try {
      new TenantOrganizationRepository(db).create({ orgName: 'skills', status: 'deleting' });
    } finally {
      db.close();
    }

    expect((await catalog('zoe-token')).statusCode).toBe(200);
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

  it('classifies every entry into exactly one of the three mutually exclusive buckets', async () => {
    const all = (await catalog('alice-token')).json() as CatalogEntryView[];
    const allNames = all.map((entry) => entry.identity).sort();
    expect(all.map((entry) => entry.bucket).sort()).toEqual(
      ['org', 'org', 'org', 'org', 'granted', 'granted', 'platform'].sort()
    );

    const orgRes = await catalog('alice-token', { bucket: 'org' });
    const platformRes = await catalog('alice-token', { bucket: 'platform' });
    const grantedRes = await catalog('alice-token', { bucket: 'granted' });

    expect(identities(orgRes)).toEqual(
      ['@acme/tool', '@acme/notes', '@beta/lib', '@beta/open'].sort()
    );
    expect(identities(platformRes)).toEqual(['@alice/pub']);
    expect(identities(grantedRes)).toEqual(['@bob/secret', '@alice/mine'].sort());

    const union = [...identities(orgRes), ...identities(platformRes), ...identities(grantedRes)];
    expect(union.sort()).toEqual(allNames);
    expect(new Set(union).size).toBe(union.length);
    // 不传 bucket 等价于 all。
    expect(identities(await catalog('alice-token', { bucket: 'all' }))).toEqual(allNames);
  });

  it('gives every entry a detail link into the shared detail page', async () => {
    const entries = (await catalog('alice-token')).json() as Array<{
      identity: string;
      detailPath: string;
    }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // 详情页路由是 /skills/:scope/:skillName；条目下发可直接使用的编码路径。
      expect(entry.detailPath, entry.identity).toBe(`/skills/${entry.identity}`);
    }
  });

  it('exposes the bucket and the source subject of each entry', async () => {
    const entries = (await catalog('alice-token')).json() as CatalogEntryView[];
    const byIdentity = new Map(entries.map((entry) => [entry.identity, entry]));

    expect(byIdentity.get('@acme/tool')).toMatchObject({
      bucket: 'org',
      source: { kind: 'organization', name: 'acme' }
    });
    expect(byIdentity.get('@acme/notes')).toMatchObject({
      bucket: 'org',
      source: { kind: 'organization', name: 'acme' }
    });
    // 多组织扁平聚合：同一桶里保留各自组织名，不按组织分组。
    expect(byIdentity.get('@beta/lib')).toMatchObject({
      bucket: 'org',
      namespaceName: 'beta',
      source: { kind: 'organization', name: 'beta' }
    });
    // 他人直授的个人 private：来源是技能所属的个人命名空间主体。
    expect(byIdentity.get('@bob/secret')).toMatchObject({
      bucket: 'granted',
      namespaceKind: 'personal',
      source: { kind: 'person', name: 'bob' }
    });
    // 本人的技能由后端给出 kind: 'self'，「我的技能」文案由 Web 映射。
    expect(byIdentity.get('@alice/mine')).toMatchObject({
      bucket: 'granted',
      source: { kind: 'self', name: 'alice' }
    });
    expect(byIdentity.get('@alice/pub')).toMatchObject({
      bucket: 'platform',
      source: { kind: 'self', name: 'alice' }
    });
  });

  it('applies the same trim rule to catalog display names', async () => {
    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    repository.createServerSkill({
      name: '@alice/blank-name',
      scope: 'alice',
      skillName: 'blank-name',
      description: 'Legacy whitespace display name',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'public',
      gitRepoPath: 'alice/blank-name',
      status: 'active-published'
    });
    const blank = repository.getSkill('@alice/blank-name')!;
    repository.createRelease({
      skillId: blank.skillId!,
      skillName: '@alice/blank-name',
      version: '1.0.0',
      sourceCommit: 'abc123',
      packagePath: 'packages/blank-name-1.0.0.tgz',
      checksum: 'checksum-blank-name',
      releaseManifest: {
        schemaVersion: 4,
        name: '@alice/blank-name',
        version: '1.0.0',
        license: 'MIT',
        displayName: '   ',
        keywords: [],
        compatibility: {},
        dependencies: {}
      },
      dependencyLock: {},
      createdBy: 'alice'
    });
    db.close();

    const entries = (await catalog('alice-token')).json() as Array<{
      identity: string;
      displayName: string;
    }>;
    expect(entries.find((entry) => entry.identity === '@alice/blank-name')?.displayName).toBe(
      'blank-name'
    );
  });

  it('rejects an invalid bucket or limit', async () => {
    for (const query of [
      { bucket: 'team' },
      { bucket: '' },
      { limit: '0' },
      { limit: '-1' },
      { limit: 'abc' },
      { limit: '1.5' }
    ]) {
      const res = await catalog('alice-token', query);
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
    }
  });

  it('applies limit after bucket filtering', async () => {
    const all = await catalog('alice-token', { limit: '2' });
    expect(all.statusCode).toBe(200);
    expect((all.json() as unknown[]).length).toBe(2);

    const org = await catalog('alice-token', { bucket: 'org', limit: '2' });
    const names = identities(org);
    expect(names.length).toBe(2);
    expect(names.every((name) => ['@acme/tool', '@acme/notes', '@beta/lib', '@beta/open'].includes(name))).toBe(
      true
    );
  });

  it('applies the keyword inside the selected bucket only', async () => {
    // notes 属于「我的组织」桶，在 granted 桶里必须为空。
    expect(identities(await catalog('alice-token', { bucket: 'org', q: 'notes' }))).toEqual(['@acme/notes']);
    expect(identities(await catalog('alice-token', { bucket: 'granted', q: 'notes' }))).toEqual([]);
    // displayName 与 keywords 都是关键词字段；大小写不敏感。
    expect(identities(await catalog('alice-token', { bucket: 'org', q: 'ACME TOOL' }))).toEqual(['@acme/tool']);
    expect(identities(await catalog('alice-token', { bucket: 'org', q: 'code-review' }))).toEqual(['@acme/tool']);
    // 跨全集时同一关键词才会越过桶边界。
    expect(identities(await catalog('alice-token', { bucket: 'all', q: 'secret' }))).toEqual(['@bob/secret']);
  });

  it('never reaches skills the caller cannot read through a keyword', async () => {
    // zoe 既不在 acme/beta，也没有被直授：private 技能对她是不可见的。
    expect(identities(await catalog('zoe-token', { q: 'secret' }))).toEqual([]);
    expect(identities(await catalog('zoe-token', { q: 'notes' }))).toEqual([]);
    // 未发布、已归档与冻结组织技能的文本命中同样不得出现。
    expect(identities(await catalog('alice-token', { q: 'draft' }))).toEqual([]);
    expect(identities(await catalog('alice-token', { q: 'archived' }))).toEqual([]);
    expect(identities(await catalog('alice-token', { q: 'legacy' }))).toEqual([]);
  });

  it('keeps the catalog order in step with the public catalog', async () => {
    const catalogNames = ((await catalog('zoe-token')).json() as CatalogEntryView[]).map(
      (entry) => entry.identity
    );
    const search = await app.inject({
      method: 'GET',
      url: '/api/skills/search',
      headers: { authorization: 'token zoe-token' }
    });
    // 公开搜索多出冻结组织的 legacy 技能（本票不改公开目录口径）；其余条目的
    // 相对顺序必须与技能目录完全一致。
    const shared = (search.json() as Array<{ name: string }>)
      .map((entry) => entry.name)
      .filter((name) => catalogNames.includes(name));
    expect(shared).toEqual(catalogNames);
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

interface CatalogEntryView {
  identity: string;
  bucket: string;
  namespaceKind: string;
  namespaceName: string;
  source: { kind: string; name: string };
}

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
