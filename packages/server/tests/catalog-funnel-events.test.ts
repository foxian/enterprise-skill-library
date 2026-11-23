import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  CatalogFunnelEventRepository,
  initDatabase,
  SkillRepository,
  TenantOrganizationRepository
} from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 技能目录漏斗事件（#199 / spec #200，本票 #206 / ADR-0077）：匿名可上报，登录态
// 由服务端补主体与时间；最小载荷落库、来源标记不参与任何权限判定、漏斗计数只取
// skill_catalog，其他来源照常入库。
describe('catalog funnel events', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;
  let observerDb: Database.Database;
  let events: CatalogFunnelEventRepository;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-funnel-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'zoe', password: 'zoe-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.setOrgOwner('acme', 'alice');
    gitea.__state.tokens.set('alice-token', 'alice');
    gitea.__state.tokens.set('zoe-token', 'zoe');
    // 真实 GiteaService 对个人仓库的团队列表返回空数组（4xx 文案已被服务层收敛），
    // 夹具按同一语义覆盖，使个人 private 技能的授权只经协作者判定。
    gitea.listRepoTeams.mockImplementation(async () => []);

    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    const repository = new SkillRepository(db);
    seedSkill(repository, { name: '@acme/open', visibility: 'public' });
    // 他人个人 private：zoe 没有任何授权，详情必须统一拒绝。
    seedSkill(repository, { name: '@alice/secret', visibility: 'private', owner: 'alice' });
    db.close();

    app = await buildApp({ dbPath, giteaService: gitea as never, repoOwner: 'esl-skills' });
    observerDb = new Database(dbPath);
    events = new CatalogFunnelEventRepository(observerDb);
  });

  afterEach(async () => {
    observerDb.close();
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function report(payload: unknown, token?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/catalog/events',
      payload: payload as Record<string, unknown>,
      ...(token ? { headers: { authorization: `token ${token}` } } : {})
    });
  }

  function recorded() {
    return events.queryEvents({ page: 1, pageSize: 100 }).items;
  }

  it('accepts the three actions anonymously and stores the minimal payload', async () => {
    const startedAt = Date.now();

    const catalog = await report({
      action: 'catalog_view',
      trafficSource: 'skill_catalog',
      bucket: 'all'
    });
    expect(catalog.statusCode).toBe(202);
    expect(catalog.body).toBe('');

    expect(
      (await report({ action: 'detail_view', skillId: 'skill-1', trafficSource: 'public_catalog' }))
        .statusCode
    ).toBe(202);
    expect(
      (
        await report({
          action: 'install_command_copy',
          skillId: 'skill-1',
          trafficSource: 'direct_or_unknown'
        })
      ).statusCode
    ).toBe(202);

    const rows = recorded();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.action)).toEqual([
      'install_command_copy',
      'detail_view',
      'catalog_view'
    ]);

    const catalogRow = rows.find((row) => row.action === 'catalog_view')!;
    expect(catalogRow).toMatchObject({
      skillId: null,
      bucket: 'all',
      trafficSource: 'skill_catalog',
      subjectUserId: null,
      subjectUsername: null
    });
    expect(rows.find((row) => row.action === 'detail_view')).toMatchObject({
      skillId: 'skill-1',
      bucket: null,
      trafficSource: 'public_catalog'
    });
    // 事件是服务端时间，且就在刚才发生；不接受客户端时间。
    for (const row of rows) {
      const occurredAt = Date.parse(row.occurredAt);
      expect(Number.isNaN(occurredAt)).toBe(false);
      expect(occurredAt).toBeGreaterThanOrEqual(startedAt - 1000);
      expect(occurredAt).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it('fills the subject from the login state and ignores client-supplied identity and time', async () => {
    const res = await report(
      {
        action: 'catalog_view',
        trafficSource: 'skill_catalog',
        subject_user_id: '999',
        subject_username: 'mallory',
        occurred_at: '2000-01-01T00:00:00.000Z'
      },
      'alice-token'
    );
    expect(res.statusCode).toBe(202);

    const [row] = recorded();
    expect(row).toMatchObject({
      action: 'catalog_view',
      subjectUserId: '1',
      subjectUsername: 'alice'
    });
    expect(Date.parse(row!.occurredAt)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'));
  });

  it('rejects an invalid action or a skill id that contradicts the action', async () => {
    const invalid = [
      { action: 'page_view' },
      { action: 'catalog_view', skillId: 'skill-1' },
      { action: 'detail_view' },
      { action: 'install_command_copy' },
      {}
    ];
    for (const payload of invalid) {
      const res = await report(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(recorded()).toHaveLength(0);
  });

  it('normalizes the traffic source and only keeps the bucket for the skill catalog', async () => {
    await report({ action: 'catalog_view' });
    await report({ action: 'catalog_view', trafficSource: 'somewhere_else' });
    await report({ action: 'catalog_view', trafficSource: 'public_catalog', bucket: 'org' });
    await report({ action: 'catalog_view', trafficSource: 'skill_catalog', bucket: 'granted' });

    const rows = recorded();
    expect(rows.map((row) => row.trafficSource)).toEqual([
      'skill_catalog',
      'public_catalog',
      'direct_or_unknown',
      'direct_or_unknown'
    ]);
    expect(rows.map((row) => row.bucket)).toEqual(['granted', null, null, null]);
  });

  it('drops a bucket that is not one of the shared catalog buckets', async () => {
    // 桶枚举与守卫来自 core（目录口径）；非法值只在 skill_catalog 下被宽容置空。
    await report({ action: 'catalog_view', trafficSource: 'skill_catalog', bucket: 'team' });
    const [row] = recorded();
    expect(row).toMatchObject({ trafficSource: 'skill_catalog', bucket: null });
  });

  it('rejects a malformed credential but accepts the absence of one', async () => {
    const anonymous = await report({ action: 'catalog_view' });
    expect(anonymous.statusCode).toBe(202);

    const bogus = await report({ action: 'catalog_view' }, 'not-a-real-token');
    expect(bogus.statusCode).toBe(401);
    expect(recorded()).toHaveLength(1);
  });

  it('does not let a forged traffic source change any permission decision', async () => {
    const forged = {
      method: 'GET' as const,
      url: '/api/skills/@alice/secret?traffic_source=skill_catalog&bucket=org',
      headers: { authorization: 'token zoe-token' }
    };
    const plain = {
      ...forged,
      url: '/api/skills/@alice/secret?traffic_source=public_catalog&bucket=granted'
    };
    const forgedRes = await app.inject(forged);
    const plainRes = await app.inject(plain);
    expect(forgedRes.statusCode).toBe(404);
    expect(plainRes.statusCode).toBe(404);
    expect(forgedRes.body).toBe(plainRes.body);

    for (const query of ['', '?traffic_source=skill_catalog']) {
      const catalog = await app.inject({
        method: 'GET',
        url: `/api/catalog/skills${query}`,
        headers: { authorization: 'token zoe-token' }
      });
      expect(catalog.statusCode).toBe(200);
      expect((catalog.json() as Array<{ identity: string }>).map((entry) => entry.identity)).not.toContain(
        '@alice/secret'
      );
    }
  });

  it('counts only the skill catalog traffic for the funnel while storing every source', async () => {
    await report({ action: 'catalog_view', trafficSource: 'skill_catalog' });
    await report({ action: 'catalog_view', trafficSource: 'skill_catalog' });
    await report({ action: 'catalog_view', trafficSource: 'public_catalog' });
    await report({ action: 'catalog_view' });
    await report({ action: 'detail_view', skillId: 'skill-1', trafficSource: 'skill_catalog' });
    await report({ action: 'install_command_copy', skillId: 'skill-1', trafficSource: 'public_catalog' });

    expect(events.countByAction({})).toEqual({
      catalog_view: 2,
      detail_view: 1,
      install_command_copy: 0
    });
    expect(events.countByAction({ trafficSource: 'public_catalog' })).toEqual({
      catalog_view: 1,
      detail_view: 0,
      install_command_copy: 1
    });
    // 不进漏斗的来源仍逐条入库，供事后重算与导出。
    expect(events.queryEvents({ page: 1, pageSize: 100 }).total).toBe(6);
  });

  it('is not blocked by the organization activation gate that covers /api/catalog', async () => {
    // 命名空间恰好叫 events 且处于删除中：门禁若仍按 `/api/catalog` 前缀取第三段
    // 当 scope，就会把上报端点当成 organization=events 的技能路由拦成 409。
    new TenantOrganizationRepository(observerDb).create({ orgName: 'events', status: 'deleting' });

    const res = await report({ action: 'catalog_view', trafficSource: 'skill_catalog' });
    expect(res.statusCode).toBe(202);
    expect(recorded()).toHaveLength(1);
  });

  it('creates the table on a database that predates this ticket without touching existing data', () => {
    const legacyPath = path.join(tmpDir, 'legacy.db');
    const legacy = initDatabase(legacyPath);
    new TenantOrganizationRepository(legacy).create({ orgName: 'legacy-org', status: 'active' });
    // 模拟升级前的库：本票新增的表不存在。
    legacy.exec('DROP TABLE catalog_funnel_events');
    legacy.close();

    const upgraded = initDatabase(legacyPath);
    const table = upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catalog_funnel_events'")
      .get() as { name: string } | undefined;
    expect(table?.name).toBe('catalog_funnel_events');
    expect(new TenantOrganizationRepository(upgraded).get('legacy-org')?.status).toBe('active');

    const repository = new CatalogFunnelEventRepository(upgraded);
    repository.record({
      action: 'catalog_view',
      trafficSource: 'skill_catalog',
      bucket: 'all'
    });
    expect(repository.queryEvents({ page: 1, pageSize: 10 }).total).toBe(1);

    // 回滚（删掉新表）只影响本票的事件表，既有表的数据仍在。
    upgraded.exec('DROP TABLE catalog_funnel_events');
    expect(new TenantOrganizationRepository(upgraded).get('legacy-org')?.status).toBe('active');
    upgraded.close();
  });
});

function seedSkill(
  repository: SkillRepository,
  seed: { name: string; visibility: string; owner?: string }
): void {
  const scope = seed.name.slice(1, seed.name.indexOf('/'));
  const skillName = seed.name.slice(seed.name.indexOf('/') + 1);
  const owner = seed.owner ?? 'alice';
  repository.createServerSkill({
    name: seed.name,
    scope,
    skillName,
    description: `${seed.name} description`,
    createdBy: owner,
    owner,
    maintainers: [owner],
    visibility: seed.visibility,
    gitRepoPath: `${scope}/${skillName}`,
    status: 'active-published'
  });
  const skill = repository.getSkill(seed.name)!;
  repository.createRelease({
    skillId: skill.skillId!,
    skillName: seed.name,
    version: '1.0.0',
    sourceCommit: 'abc123',
    packagePath: `packages/${skillName}-1.0.0.tgz`,
    checksum: 'checksum-1.0.0',
    releaseManifest: {
      schemaVersion: 3,
      name: seed.name,
      version: '1.0.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    },
    dependencyLock: {},
    createdBy: owner
  });
}
