import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';
import { parseClientUserAgent, truncateClientIp } from '../src/services/download-log.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 下载日志与聚合计数（ADR-0067 / #131）：包发放端点记录每次获取尝试，
// 成功计一次下载（npm 式不去重），失败落明细但不计数；IP 截断后落库，
// User-Agent 拆成环境字段，requested specifier 由 CLI 以 ?requested= 附带。
describe('download log recording', () => {
  let tmpDir: string;
  let dbPath: string;
  let packageRoot: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;
  let raw: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-download-'));
    dbPath = path.join(tmpDir, 'test.db');
    packageRoot = path.join(tmpDir, 'packages');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'zoe', password: 'zoe-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.tokens.set('alice-token', 'alice');
    gitea.__state.tokens.set('zoe-token', 'zoe');

    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    db.close();

    app = buildApp({ dbPath, packageRoot, giteaService: gitea as never, repoOwner: 'acme' });
    raw = new Database(dbPath);
  });

  afterEach(async () => {
    raw.close();
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function addRelease(
    skillId: string,
    name: string,
    version: string,
    owner = 'alice'
  ): { version: string; checksum: string } {
    const bytes = Buffer.from(JSON.stringify({ name, version }));
    const checksum = `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}.json`;
    const dir = path.join(packageRoot, skillId, version);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, checksum), bytes);
    const db = initDatabase(dbPath);
    new SkillRepository(db).createRelease({
      skillId,
      skillName: name,
      version,
      sourceCommit: 'abc123',
      packagePath: `${skillId}/${version}/${checksum}`,
      checksum,
      releaseManifest: {
        schemaVersion: 3,
        name,
        version,
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      },
      dependencyLock: {},
      createdBy: owner
    });
    db.close();
    return { version, checksum };
  }

  function seedPublishedSkill(seed: {
    name: string;
    scope: string;
    skillName: string;
    version: string;
    owner?: string;
    visibility?: string;
  }): { skillId: string; version: string; checksum: string } {
    const db = initDatabase(dbPath);
    const skill = new SkillRepository(db).createServerSkill({
      name: seed.name,
      scope: seed.scope,
      skillName: seed.skillName,
      description: `${seed.name} description`,
      createdBy: seed.owner ?? 'alice',
      owner: seed.owner ?? 'alice',
      maintainers: [seed.owner ?? 'alice'],
      visibility: seed.visibility ?? 'public',
      gitRepoPath: `${seed.scope}/${seed.skillName}`,
      status: 'active-published'
    });
    db.close();
    return {
      skillId: skill.skillId!,
      ...addRelease(skill.skillId!, seed.name, seed.version, seed.owner ?? 'alice')
    };
  }

  function fetchPackage(
    target: { skillId: string; version: string; checksum: string },
    options: { token?: string; requested?: string; headers?: Record<string, string> } = {}
  ) {
    const query = options.requested ? `?requested=${encodeURIComponent(options.requested)}` : '';
    return app.inject({
      method: 'GET',
      url: `/api/packages/${target.skillId}/${target.version}/${target.checksum}${query}`,
      headers: {
        authorization: `token ${options.token ?? 'alice-token'}`,
        ...options.headers
      }
    });
  }

  function logRows(): Array<Record<string, unknown>> {
    return raw
      .prepare(`SELECT * FROM download_logs ORDER BY id`)
      .all() as Array<Record<string, unknown>>;
  }

  function counts(skillId: string): Array<{ version: string; day: string; count: number }> {
    return raw
      .prepare(`SELECT version, day, count FROM download_counts WHERE skill_id = ? ORDER BY version, day`)
      .all(skillId) as Array<{ version: string; day: string; count: number }>;
  }

  it('records one detail row and bumps total, version and day counts on a successful fetch', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });

    const response = await fetchPackage(tool, {
      requested: '^1.0',
      headers: { 'user-agent': 'esl/0.1.1 node/22.14.0 linux/x64' }
    });

    expect(response.statusCode).toBe(200);
    const rows = logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      skill_id: tool.skillId,
      skill_identity: '@acme/tool',
      version: '1.0.0',
      requested_specifier: '^1.0',
      username: 'alice',
      os_platform: 'linux',
      os_arch: 'x64',
      esl_version: '0.1.1',
      node_version: '22.14.0',
      result: 'success',
      failure_reason: null
    });
    const day = (rows[0].downloaded_at as string).slice(0, 10);
    expect(counts(tool.skillId)).toEqual([
      { version: '', day: '', count: 1 },
      { version: '', day, count: 1 },
      { version: '1.0.0', day: '', count: 1 }
    ]);
  });

  it('counts every package fetch without de-duplication (npm-style)', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });

    await fetchPackage(tool);
    await fetchPackage(tool);
    await fetchPackage(tool);

    expect(logRows()).toHaveLength(3);
    expect(counts(tool.skillId).find((row) => row.version === '' && row.day === '')?.count).toBe(3);
    expect(counts(tool.skillId).find((row) => row.version === '1.0.0')?.count).toBe(3);
  });

  it('counts each dependency node as its own download when a dependency graph is fetched', async () => {
    const root = seedPublishedSkill({
      name: '@acme/root',
      scope: 'acme',
      skillName: 'root',
      version: '1.0.0'
    });
    const depA = seedPublishedSkill({
      name: '@acme/dep-a',
      scope: 'acme',
      skillName: 'dep-a',
      version: '2.0.0'
    });
    const depB = seedPublishedSkill({
      name: '@acme/dep-b',
      scope: 'acme',
      skillName: 'dep-b',
      version: '0.3.0'
    });

    // 依赖解析由 CLI 逐包 GET 实现：根技能与每个依赖节点各一次请求。
    for (const node of [root, depA, depB]) {
      const response = await fetchPackage(node);
      expect(response.statusCode).toBe(200);
    }

    expect(logRows()).toHaveLength(3);
    for (const node of [root, depA, depB]) {
      expect(counts(node.skillId).find((row) => row.version === '' && row.day === '')?.count).toBe(1);
    }
    expect(counts(depA.skillId).find((row) => row.version === '2.0.0')?.count).toBe(1);
  });

  it('records a failure row without counting when the caller is unauthenticated', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/packages/${tool.skillId}/${tool.version}/${tool.checksum}`
    });

    expect(response.statusCode).toBe(401);
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]).toMatchObject({
      skill_id: tool.skillId,
      username: null,
      result: 'failure',
      failure_reason: 'unauthorizedInvalidToken'
    });
    expect(counts(tool.skillId)).toEqual([]);
  });

  it('records a failure row without counting when the caller lacks read access', async () => {
    const secret = seedPublishedSkill({
      name: '@acme/secret',
      scope: 'acme',
      skillName: 'secret',
      version: '1.0.0',
      owner: 'zoe',
      visibility: 'private'
    });

    const response = await fetchPackage(secret);

    expect(response.statusCode).toBe(403);
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]).toMatchObject({
      skill_id: secret.skillId,
      skill_identity: '@acme/secret',
      username: 'alice',
      result: 'failure',
      failure_reason: 'forbiddenNoAccessToThisPrivateSkillRequestAccessFromItsMaintainers'
    });
    expect(counts(secret.skillId)).toEqual([]);
  });

  it('records a failure row without counting when the skill or package is missing', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });

    const unknownSkill = await app.inject({
      method: 'GET',
      url: '/api/packages/sk_does_not_exist/1.0.0/sha256-abc.json',
      headers: { authorization: 'token alice-token' }
    });
    expect(unknownSkill.statusCode).toBe(404);

    const missingFile = await app.inject({
      method: 'GET',
      url: `/api/packages/${tool.skillId}/1.0.0/sha256-missing.json`,
      headers: { authorization: 'token alice-token' }
    });
    expect(missingFile.statusCode).toBe(404);

    const rows = logRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ failure_reason: 'skillNotFound', result: 'failure' });
    expect(rows[1]).toMatchObject({
      skill_id: tool.skillId,
      version: '1.0.0',
      failure_reason: 'publishedSkillPackageNotFound',
      result: 'failure'
    });
    expect(counts(tool.skillId)).toEqual([]);
  });

  it('truncates the client IP from the proxy-appended X-Forwarded-For hop', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });

    // nginx 用 $proxy_add_x_forwarded_for 追加：客户端自带的头在前，nginx 看到的
    // 真实来源在后。必须采信最后一个，否则下载方自带一个头就能伪造来源网段。
    await fetchPackage(tool, { headers: { 'x-forwarded-for': '203.0.113.77, 10.0.0.1' } });
    await fetchPackage(tool, { headers: { 'x-forwarded-for': '2001:db8:1234:5678::1' } });
    await fetchPackage(tool, { headers: { 'x-forwarded-for': '10.0.0.1' } });

    const rows = logRows();
    expect(rows[0].client_ip_truncated).toBe('10.0.0.0/24');
    expect(rows[1].client_ip_truncated).toBe('2001:db8:1234::/48');
    expect(rows[2].client_ip_truncated).toBe('10.0.0.0/24');
  });

  it('still counts downloads from clients without a User-Agent and leaves the specifier null', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });

    const response = await fetchPackage(tool);

    expect(response.statusCode).toBe(200);
    expect(logRows()[0]).toMatchObject({
      requested_specifier: null,
      os_platform: null,
      os_arch: null,
      esl_version: null,
      node_version: null,
      // 无代理头时回退连接地址，同样截断后才落库。
      client_ip_truncated: '127.0.0.0/24',
      result: 'success'
    });
    expect(counts(tool.skillId).find((row) => row.version === '' && row.day === '')?.count).toBe(1);
  });

  it('exposes the cross-version download count in search results', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });
    const other = seedPublishedSkill({
      name: '@acme/other',
      scope: 'acme',
      skillName: 'other',
      version: '2.0.0'
    });

    await fetchPackage(tool);
    await fetchPackage(tool);
    await fetchPackage(other);

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/search',
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(200);
    const counts = new Map(
      (response.json() as Array<{ name: string; downloadCount: number }>).map((result) => [
        result.name,
        result.downloadCount
      ])
    );
    expect(counts.get('@acme/tool')).toBe(2);
    expect(counts.get('@acme/other')).toBe(1);
  });

  it('exposes download counts to anonymous search and reports zero for untouched skills', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });
    seedPublishedSkill({ name: '@acme/other', scope: 'acme', skillName: 'other', version: '1.0.0' });
    await fetchPackage(tool);

    const response = await app.inject({ method: 'GET', url: '/api/skills/search' });

    expect(response.statusCode).toBe(200);
    const counts = new Map(
      (response.json() as Array<{ name: string; downloadCount: number }>).map((result) => [
        result.name,
        result.downloadCount
      ])
    );
    expect(counts.get('@acme/tool')).toBe(1);
    expect(counts.get('@acme/other')).toBe(0);
  });

  it('exposes the download count on the authenticated skill inventory', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });
    await fetchPackage(tool);
    await fetchPackage(tool);

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(200);
    const item = (response.json() as Array<{ name: string; downloadCount: number }>).find(
      (entry) => entry.name === '@acme/tool'
    );
    expect(item?.downloadCount).toBe(2);
  });

  it('exposes the download count in the permissions skill context', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });
    await fetchPackage(tool);

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/acme/tool/permissions',
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { skill: { downloadCount: number } }).skill.downloadCount).toBe(1);
  });

  it('exposes the total and per-version download counts in the skill detail response', async () => {
    const tool = seedPublishedSkill({
      name: '@acme/tool',
      scope: 'acme',
      skillName: 'tool',
      version: '1.0.0'
    });
    const v2 = { skillId: tool.skillId, ...addRelease(tool.skillId, '@acme/tool', '2.0.0') };

    await fetchPackage(tool);
    await fetchPackage(tool);
    await fetchPackage(v2);

    const response = await app.inject({
      method: 'GET',
      url: `/api/skills/${encodeURIComponent('@acme/tool')}`,
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      downloadCount: number;
      releases: Array<{ version: string; downloadCount: number }>;
    };
    expect(body.downloadCount).toBe(3);
    const perVersion = new Map(body.releases.map((release) => [release.version, release.downloadCount]));
    expect(perVersion.get('1.0.0')).toBe(2);
    expect(perVersion.get('2.0.0')).toBe(1);
  });
});

describe('client metadata parsing', () => {
  it('splits the ESL User-Agent into environment fields', () => {
    expect(parseClientUserAgent('esl/0.1.1 node/22.14.0 linux/x64')).toEqual({
      eslVersion: '0.1.1',
      nodeVersion: '22.14.0',
      osPlatform: 'linux',
      osArch: 'x64'
    });
  });

  it('leaves unparseable fields null rather than dropping the whole User-Agent', () => {
    expect(parseClientUserAgent('esl/0.1.1 curl/8.0.0')).toEqual({
      eslVersion: '0.1.1',
      nodeVersion: null,
      osPlatform: 'curl',
      osArch: '8.0.0'
    });
    expect(parseClientUserAgent(undefined)).toEqual({
      eslVersion: null,
      nodeVersion: null,
      osPlatform: null,
      osArch: null
    });
  });

  it('truncates IPv4 to /24 and IPv6 to /48, normalising IPv4-mapped addresses', () => {
    expect(truncateClientIp('203.0.113.77')).toBe('203.0.113.0/24');
    expect(truncateClientIp('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(truncateClientIp('2001:db8:1234:5678:9abc::1')).toBe('2001:db8:1234::/48');
    expect(truncateClientIp('  198.51.100.9  ')).toBe('198.51.100.0/24');
  });

  it('returns null for input that is not an IP address', () => {
    expect(truncateClientIp(undefined)).toBeNull();
    expect(truncateClientIp('')).toBeNull();
    expect(truncateClientIp('not-an-ip')).toBeNull();
    expect(truncateClientIp('999.1.1.1')).toBeNull();
  });
});
