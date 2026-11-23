import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  CatalogFunnelEventRepository,
  initDatabase,
  SkillRepository,
  TenantOrganizationRepository
} from '../src/db/database.js';
import {
  DEV_ACCOUNT_PASSWORD,
  DEV_ACCOUNTS,
  seedDevelopmentAccounts
} from '../src/seed.js';
import {
  CATALOG_ACCEPTANCE_SKILLS,
  seedCatalogAcceptanceData
} from '../src/seed-catalog.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 技能目录验收数据与两账号走查（#207 / spec #200 AC1–AC12）。
// Web 侧行为由 T4/T5/T6 的组件测试覆盖；这里以 server HTTP 行为为主，断言
// 「不同主体看到什么 / 能否打开 / 事件如何计数」，不锚内部实现细节。
describe('skill catalog acceptance seed', () => {
  let tmpDir: string;
  let dbPath: string;
  let gitea: GlobalGiteaFake;
  let app: FastifyInstance;

  const bob = DEV_ACCOUNTS.multiOrgMember;
  const carol = DEV_ACCOUNTS.noOrgUser;
  const alice = DEV_ACCOUNTS.publisher;
  const dave = DEV_ACCOUNTS.otherPerson;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-catalog-acceptance-'));
    dbPath = path.join(tmpDir, 'acceptance.db');
    gitea = createGlobalGitea();
    // 与真实 GiteaService 一致：个人仓库不属于任何组织，团队列表视为空；组织仓库
    // 返回已挂载的团队。假 Gitea 直接抛错，这里在测试侧补齐服务端的语义。
    const listRepoTeams = gitea.listRepoTeams.getMockImplementation()!;
    gitea.listRepoTeams.mockImplementation(async (owner: string, repo: string) =>
      gitea.__state.orgs.has(owner) ? listRepoTeams(owner, repo) : []
    );

    const db = initDatabase(dbPath);
    try {
      await seedDevelopmentAccounts(gitea as never, new TenantOrganizationRepository(db));
    } finally {
      db.close();
    }
    await seedCatalogAcceptanceData(dbPath, gitea as never);

    app = await buildApp({ dbPath, giteaService: gitea as never, repoOwner: 'esl-skills' });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function tokenFor(username: string): Promise<string> {
    const token = await gitea.loginUser(username, DEV_ACCOUNT_PASSWORD);
    if (!token) throw new Error(`Failed to log in seeded account: ${username}`);
    return token;
  }

  async function catalog(
    token: string | null,
    query: Record<string, string> = {}
  ): Promise<{ statusCode: number; json: () => unknown; body: string }> {
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

  async function detail(token: string | null, identity: string) {
    return app.inject({
      method: 'GET',
      url: `/api/skills/${identity}`,
      ...(token ? { headers: { authorization: `token ${token}` } } : {})
    });
  }

  async function withRepositories<T>(
    action: (repositories: {
      skills: SkillRepository;
      events: CatalogFunnelEventRepository;
      tenants: TenantOrganizationRepository;
    }) => T
  ): Promise<T> {
    const db = initDatabase(dbPath);
    try {
      return action({
        skills: new SkillRepository(db),
        events: new CatalogFunnelEventRepository(db),
        tenants: new TenantOrganizationRepository(db)
      });
    } finally {
      db.close();
    }
  }

  const bobPlatform = [
    '@alice/anon-tool',
    '@alice/community-tool',
    '@bob/own-public'
  ];
  const bobOrganization = [
    '@acme/all-managers-tool',
    '@acme/all-readers-tool',
    '@acme/all-writers-tool',
    '@acme/custom-team-tool',
    '@acme/member-grant-tool',
    '@acme/public-tool',
    '@beta/open-tool'
  ];
  const bobGranted = ['@bob/own-private', '@dave/private-note'];
  const bobAll = [...bobPlatform, ...bobOrganization, ...bobGranted].sort();

  it('seeds the two acceptance accounts and the two-organization membership matrix', async () => {
    expect((await gitea.listUserOrgs(bob)).map((org) => org.name).sort()).toEqual(['acme', 'beta']);
    expect(await gitea.listUserOrgs(carol)).toEqual([]);
    expect(await gitea.listUserOrgs(dave)).toEqual([]);

    for (const org of ['acme', 'beta']) {
      const teams = await gitea.listTeams(org);
      const names = teams.map((team) => team.name).sort();
      expect(names).toEqual(
        expect.arrayContaining(['Owners', 'all-managers', 'all-readers', 'all-writers', 'org-managers'])
      );
      if (org === 'acme') {
        // 自定义团队只建在 acme：逻辑团队的三个后端投影齐备。
        expect(names).toEqual(
          expect.arrayContaining(['reviewers-read', 'reviewers-write', 'reviewers-manage'])
        );
      }
      const teamNamesFor = async (username: string): Promise<string[]> => {
        const memberOf: string[] = [];
        for (const team of teams) {
          if (await gitea.isTeamMember(team.id, username)) memberOf.push(team.name);
        }
        return memberOf.sort();
      };
      expect(await teamNamesFor(bob)).toEqual(
        expect.arrayContaining(['all-managers', 'all-readers', 'all-writers'])
      );
      expect(await teamNamesFor(bob)).not.toContain('org-managers');
      expect(await teamNamesFor(alice)).toEqual(
        expect.arrayContaining([
          'Owners',
          'all-managers',
          'all-readers',
          'all-writers',
          'org-managers'
        ])
      );
    }

    await withRepositories(({ skills, tenants }) => {
      expect(tenants.get('acme')?.status).toBe('active');
      expect(tenants.get('beta')?.status).toBe('active');
      expect(skills.getSkill('@acme/public-tool')?.status).toBe('active-published');
    });
  });

  it('is idempotent: repeated runs converge without duplicate skills or releases', async () => {
    await seedCatalogAcceptanceData(dbPath, gitea as never);
    await seedCatalogAcceptanceData(dbPath, gitea as never);

    await withRepositories(({ skills }) => {
      for (const definition of CATALOG_ACCEPTANCE_SKILLS) {
        const skill = skills.getSkill(definition.name);
        expect(skill, definition.name).toBeTruthy();
        expect(skill!.visibility).toBe(definition.visibility);
        expect(skill!.status).toBe(definition.status);
        const releases = skills.getReleases(definition.name);
        expect(releases, definition.name).toHaveLength(definition.version ? 1 : 0);
      }
    });

    // 重复执行后目录结果不变（幂等写库 + 幂等 Gitea 挂载）。
    expect(identities(await catalog(await tokenFor(bob)))).toEqual(bobAll);
  });

  it('AC2/AC4: the multi-organization member sees exactly the installable set in three exclusive buckets', async () => {
    const token = await tokenFor(bob);
    expect(identities(await catalog(token))).toEqual(bobAll);
    expect(identities(await catalog(token, { bucket: 'all' }))).toEqual(bobAll);

    expect(identities(await catalog(token, { bucket: 'platform' }))).toEqual([...bobPlatform].sort());
    expect(identities(await catalog(token, { bucket: 'org' }))).toEqual([...bobOrganization].sort());
    expect(identities(await catalog(token, { bucket: 'granted' }))).toEqual([...bobGranted].sort());

    // 互斥且全覆盖：三桶并集恰好等于全集，任何技能只出现一次。
    const union = [
      ...identities(await catalog(token, { bucket: 'platform' })),
      ...identities(await catalog(token, { bucket: 'org' })),
      ...identities(await catalog(token, { bucket: 'granted' }))
    ].sort();
    expect(union).toEqual(bobAll);
    expect(new Set(union).size).toBe(union.length);

    // 未发布、已归档与无权技能都不出现。
    for (const absent of [
      '@acme/draft-tool',
      '@acme/retired-tool',
      '@acme/secret-tool',
      '@dave/unshared-note'
    ]) {
      expect(bobAll).not.toContain(absent);
    }

    const entries = (await catalog(token)).json() as Array<Record<string, unknown>>;
    const byIdentity = new Map(entries.map((entry) => [entry.identity as string, entry]));
    // 就近：组织 public 只在「我的组织」；本人个人 public 只在「平台公开」。
    expect(byIdentity.get('@acme/public-tool')).toMatchObject({
      bucket: 'org',
      namespaceKind: 'organization',
      namespaceName: 'acme',
      source: { kind: 'organization', name: 'acme' }
    });
    expect(byIdentity.get('@beta/open-tool')).toMatchObject({
      bucket: 'org',
      namespaceName: 'beta',
      source: { kind: 'organization', name: 'beta' }
    });
    expect(byIdentity.get('@bob/own-public')).toMatchObject({
      bucket: 'platform',
      namespaceKind: 'personal',
      source: { kind: 'self', name: 'bob' }
    });
    // 授权给我：他人直授显示个人主体，本人 private 显示「我的技能」来源（kind self）。
    expect(byIdentity.get('@dave/private-note')).toMatchObject({
      bucket: 'granted',
      source: { kind: 'person', name: 'dave' }
    });
    expect(byIdentity.get('@bob/own-private')).toMatchObject({
      bucket: 'granted',
      source: { kind: 'self', name: 'bob' }
    });
    // 卡片字段齐全（AC7 的 server 侧契约；渲染由 T4 组件测试覆盖）。
    expect(byIdentity.get('@acme/member-grant-tool')).toMatchObject({
      identity: '@acme/member-grant-tool',
      displayName: 'Acme Member Grant Tool',
      description: '经 Acme 成员授权（协作者）到达普通成员的私有技能',
      latestStableVersion: '1.0.0',
      visibility: 'private',
      downloadCount: 0
    });
  });

  it('AC5: the user without organizations gets platform content and empty org/granted buckets', async () => {
    const token = await tokenFor(carol);

    expect(identities(await catalog(token))).toEqual(
      [
        '@alice/anon-tool',
        '@alice/community-tool',
        '@acme/public-tool',
        '@beta/open-tool',
        '@bob/own-public'
      ].sort()
    );
    expect(identities(await catalog(token, { bucket: 'platform' }))).toHaveLength(5);
    expect(identities(await catalog(token, { bucket: 'org' }))).toEqual([]);
    expect(identities(await catalog(token, { bucket: 'granted' }))).toEqual([]);

    // 匿名（免登录公开目录）只看到 anonymous 档，且与登录平台桶同源。
    const anonymousSearch = await app.inject({ method: 'GET', url: '/api/skills/search' });
    expect(anonymousSearch.statusCode).toBe(200);
    expect((anonymousSearch.json() as Array<{ name: string }>).map((entry) => entry.name)).toEqual([
      '@alice/anon-tool'
    ]);
  });

  it('AC3: an unauthorized account cannot distinguish private, archived and nonexistent details', async () => {
    const token = await tokenFor(carol);

    const unauthorizedPrivate = await detail(token, '@acme/secret-tool');
    const unauthorizedPersonal = await detail(token, '@dave/unshared-note');
    const archived = await detail(token, '@acme/retired-tool');
    const missing = await detail(token, '@acme/does-not-exist');

    for (const response of [unauthorizedPrivate, unauthorizedPersonal, archived, missing]) {
      expect(response.statusCode).toBe(404);
    }
    // 三态统一：响应体逐字节一致，不泄露名称、版本、下载量等任何元数据。
    expect(unauthorizedPrivate.body).toBe(missing.body);
    expect(unauthorizedPersonal.body).toBe(missing.body);
    expect(archived.body).toBe(missing.body);
    expect(archived.body).not.toContain('retired');

    // 越权技能也不会因关键词进入列表。
    expect(identities(await catalog(token, { q: 'secret' }))).toEqual([]);
    expect(identities(await catalog(token, { q: 'unshared' }))).toEqual([]);
    expect(identities(await catalog(token, { q: 'retired' }))).toEqual([]);
  });

  it('AC6: keyword is ANDed with the selected bucket and never reaches unauthorized skills', async () => {
    const token = await tokenFor(bob);

    expect(identities(await catalog(token, { bucket: 'org', q: 'custom-team' }))).toEqual([
      '@acme/custom-team-tool'
    ]);
    // 同一个关键词在别的桶里不越过桶边界。
    expect(identities(await catalog(token, { bucket: 'platform', q: 'custom-team' }))).toEqual([]);
    // keywords 元数据参与匹配（code-review 只挂在自定义团队技能上）。
    expect(identities(await catalog(token, { q: 'code-review' }))).toEqual(['@acme/custom-team-tool']);
    // 显示名大小写不敏感。
    expect(identities(await catalog(token, { q: 'ACME MEMBER GRANT' }))).toEqual([
      '@acme/member-grant-tool'
    ]);
    // 无权 / 未发布 / 归档技能即使文本命中也不会出现。
    expect(identities(await catalog(token, { q: 'secret' }))).toEqual([]);
    expect(identities(await catalog(token, { q: 'draft' }))).toEqual([]);
  });

  it('AC8/AC11: authorized private details open for the member; anonymous only sees anonymous', async () => {
    const bobToken = await tokenFor(bob);
    for (const identity of ['@acme/member-grant-tool', '@acme/custom-team-tool', '@dave/private-note']) {
      const response = await detail(bobToken, identity);
      expect(response.statusCode, identity).toBe(200);
      expect((response.json() as { name: string }).name).toBe(identity);
    }

    // 匿名：anonymous 技能可看；public 技能仍要求登录（US14 现状不变）。
    expect((await detail(null, '@alice/anon-tool')).statusCode).toBe(200);
    expect((await detail(null, '@alice/community-tool')).statusCode).toBe(401);
    // 已登录无组织用户对 public 技能与组织 public 技能同源可读。
    const carolToken = await tokenFor(carol);
    expect((await detail(carolToken, '@alice/community-tool')).statusCode).toBe(200);
    expect((await detail(carolToken, '@acme/public-tool')).statusCode).toBe(200);
  });

  it('AC9: permission tightening and archival remove the entry and unify detail rejection', async () => {
    const token = await tokenFor(bob);
    expect(identities(await catalog(token))).toContain('@acme/member-grant-tool');

    // 权限收紧：撤销成员授权后，列表不再返回、详情与不存在同形。
    await gitea.removeCollaborator('acme', 'member-grant-tool', bob);
    const afterRevoke = identities(await catalog(token));
    expect(afterRevoke).not.toContain('@acme/member-grant-tool');
    const revokedDetail = await detail(token, '@acme/member-grant-tool');
    const missing = await detail(token, '@acme/does-not-exist');
    expect(revokedDetail.statusCode).toBe(404);
    expect(revokedDetail.body).toBe(missing.body);

    // 归档：列表移除、详情统一拒绝（已归档对所有人同形，否则会泄露存在性）。
    await withRepositories(({ skills }) => skills.archiveSkill('@acme/public-tool'));
    await gitea.setRepositoryArchived('acme', 'public-tool', true);
    expect(identities(await catalog(token))).not.toContain('@acme/public-tool');
    const archivedDetail = await detail(token, '@acme/public-tool');
    expect(archivedDetail.statusCode).toBe(404);
    expect(archivedDetail.body).toBe(missing.body);
  });

  it('AC10: the three funnel actions are countable from skill_catalog only', async () => {
    const token = await tokenFor(bob);
    const skillId = await withRepositories(
      ({ skills }) => skills.getSkill('@acme/public-tool')!.skillId!
    );

    const post = (body: Record<string, unknown>, withToken: boolean) =>
      app.inject({
        method: 'POST',
        url: '/api/catalog/events',
        payload: body,
        ...(withToken ? { headers: { authorization: `token ${token}` } } : {})
      });

    expect(
      (await post({ action: 'catalog_view', bucket: 'all', trafficSource: 'skill_catalog' }, true))
        .statusCode
    ).toBe(202);
    expect(
      (
        await post(
          { action: 'detail_view', skillId, bucket: 'all', trafficSource: 'skill_catalog' },
          true
        )
      ).statusCode
    ).toBe(202);
    expect(
      (
        await post(
          { action: 'install_command_copy', skillId, trafficSource: 'skill_catalog' },
          true
        )
      ).statusCode
    ).toBe(202);
    // 公开目录与直拼流量照常入库，但不进本漏斗。
    await post({ action: 'detail_view', skillId, trafficSource: 'public_catalog' }, false);
    await post({ action: 'detail_view', skillId, trafficSource: 'direct_or_unknown' }, false);

    await withRepositories(({ events }) => {
      expect(events.countByAction()).toEqual({
        catalog_view: 1,
        detail_view: 1,
        install_command_copy: 1
      });
      expect(events.countByAction({ trafficSource: 'public_catalog' })).toEqual({
        catalog_view: 0,
        detail_view: 1,
        install_command_copy: 0
      });
    });
  });

  it('AC12: the dataset covers every visibility, grant form, unpublished and archived skill', async () => {
    await withRepositories(({ skills }) => {
      const definitions = new Map(CATALOG_ACCEPTANCE_SKILLS.map((entry) => [entry.name, entry]));
      expect(definitions.size).toBe(CATALOG_ACCEPTANCE_SKILLS.length);

      expect(definitions.get('@alice/anon-tool')?.visibility).toBe('anonymous');
      expect(definitions.get('@alice/community-tool')?.visibility).toBe('public');
      expect(definitions.get('@acme/public-tool')?.visibility).toBe('public');
      expect(definitions.get('@acme/all-readers-tool')?.grant).toEqual({
        kind: 'share-tier',
        tier: 'read'
      });
      expect(definitions.get('@acme/custom-team-tool')?.grant).toEqual({
        kind: 'custom-team',
        team: 'reviewers',
        member: bob
      });
      expect(definitions.get('@acme/member-grant-tool')?.grant).toEqual({
        kind: 'member',
        username: bob
      });
      expect(definitions.get('@dave/private-note')?.grant).toEqual({
        kind: 'member',
        username: bob
      });
      expect(skills.getSkill('@bob/own-private')).toMatchObject({
        owner: bob,
        visibility: 'private'
      });
      expect(skills.getSkill('@bob/own-public')).toMatchObject({
        owner: bob,
        visibility: 'public'
      });
      expect(skills.getSkill('@acme/draft-tool')?.status).toBe('active-unreleased');
      expect(skills.getReleases('@acme/draft-tool')).toEqual([]);
      expect(skills.getSkill('@acme/retired-tool')?.status).toBe('archived');
      expect(skills.getReleases('@acme/retired-tool')).toHaveLength(1);
    });
  });
});
