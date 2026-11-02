import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { initDatabase } from '../src/db/database.js';

// 第三档可见性（ADR-0073）：anonymous 是主动的匿名消费面。匿名访客能发现、
// 查看、下载、安装；public 只对已登录用户开放；private 规则不变。切换与发布
// 都要用已冻锁验证整条依赖链，反向收紧要保护仍匿名公开的依赖方。
describe('anonymous skill visibility', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let gitea: Record<string, ReturnType<typeof vi.fn>>;

  const tokens: Record<string, string> = { 'alice-token': 'alice', 'zoe-token': 'zoe' };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-anonymous-'));
    gitea = {
      validateToken: vi.fn(async (token: string) => {
        const username = tokens[token];
        return username ? { id: username === 'alice' ? 1 : 2, username } : null;
      }),
      createRepo: vi.fn(async (scope: string, name: string) => ({ full_name: `${scope}/${name}` })),
      getReleaseTag: vi.fn(async () => null),
      createReleaseTag: vi.fn(async () => undefined),
      readSourceTree: vi.fn(async (owner: string, name: string) => ({
        'SKILL.md': Buffer.from(`---\nname: ${name}\ndescription: ${name} skill\n---\n`),
        'release.json': Buffer.from(JSON.stringify({
          schemaVersion: 3,
          name: `@${owner}/${name}`,
          version: '0.1.0',
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }))
      })),
      listRepoTeams: vi.fn(async () => []),
      isTeamMember: vi.fn(async () => false),
      getCollaboratorPermission: vi.fn(async () => 'none')
    };
    const db = initDatabase(path.join(tmpDir, 'test.db'));
    db.close();
    app = buildApp({
      dbPath: path.join(tmpDir, 'test.db'),
      packageRoot: path.join(tmpDir, 'packages'),
      giteaService: gitea as any,
      repoOwner: 'esl-skills'
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function upload(name: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name, description: `${name} skill` }
    });
    expect(response.statusCode).toBe(201);
  }

  async function setVisibility(name: string, visibility: string) {
    return app.inject({
      method: 'POST',
      url: `/api/skills/@alice/${name}/visibility`,
      headers: { authorization: 'token alice-token' },
      payload: { visibility }
    });
  }

  async function publish(
    name: string,
    version: string,
    dependencies: Record<string, string> = {},
    token = 'alice-token'
  ) {
    gitea.readSourceTree.mockResolvedValueOnce({
      'SKILL.md': Buffer.from(`---\nname: ${name}\ndescription: ${name} skill\n---\n`),
      'release.json': Buffer.from(JSON.stringify({
        schemaVersion: 3,
        name: `@alice/${name}`,
        version: '0.1.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies
      }))
    });
    return app.inject({
      method: 'POST',
      url: `/api/skills/@alice/${name}/releases`,
      headers: { authorization: `token ${token}` },
      payload: { version, sourceCommit: `commit-${name}-${version}` }
    });
  }

  async function publishAnonymousSkill(name: string): Promise<{ skillId: string; checksum: string }> {
    await upload(name);
    expect((await setVisibility(name, 'anonymous')).statusCode).toBe(200);
    const response = await publish(name, '1.0.0');
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it('lets anonymous visitors search, view the safe detail, and download a published anonymous skill', async () => {
    const release = await publishAnonymousSkill('open');

    const search = await app.inject({ method: 'GET', url: '/api/skills/search' });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual([
      expect.objectContaining({ name: '@alice/open', visibility: 'anonymous' })
    ]);

    const detail = await app.inject({ method: 'GET', url: '/api/skills/@alice/open' });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body).toMatchObject({
      name: '@alice/open',
      visibility: 'anonymous',
      versions: ['1.0.0'],
      releases: [expect.objectContaining({ version: '1.0.0', skillId: release.skillId })]
    });
    // 匿名详情不复用管理 DTO：源码仓库、协作者、所有者与未发布状态都不下发。
    expect(body).not.toHaveProperty('gitRepoPath');
    expect(body).not.toHaveProperty('cloneUrl');
    expect(body).not.toHaveProperty('maintainers');
    expect(body).not.toHaveProperty('owner');
    expect(body).not.toHaveProperty('status');

    const download = await app.inject({
      method: 'GET',
      url: `/api/packages/${release.skillId}/1.0.0/${release.checksum}.zip`
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('application/zip');
  });

  it('keeps public skills behind login after the anonymous tier exists', async () => {
    await upload('pub');
    expect((await setVisibility('pub', 'public')).statusCode).toBe(200);
    expect((await publish('pub', '1.0.0')).statusCode).toBe(201);

    const anonymousSearch = await app.inject({ method: 'GET', url: '/api/skills/search' });
    expect(anonymousSearch.json()).toEqual([]);

    const anonymousDetail = await app.inject({ method: 'GET', url: '/api/skills/@alice/pub' });
    expect(anonymousDetail.statusCode).toBe(401);

    const loggedIn = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/pub',
      headers: { authorization: 'token zoe-token' }
    });
    expect(loggedIn.statusCode).toBe(200);
  });

  it('blocks switching to anonymous when the published dependency chain is not anonymous', async () => {
    await upload('dep');
    // 先发布依赖（private），再发布根（private 根不要求全链 public）。
    expect((await publish('dep', '1.0.0')).statusCode).toBe(201);
    await upload('root');
    expect((await publish('root', '1.0.0', { '@alice/dep': '*' })).statusCode).toBe(201);

    const blocked = await setVisibility('root', 'anonymous');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('anonymousVisibilityRequiresAnonymousDependencyChain');
    expect(blocked.json().params.dependencies).toContain('@alice/dep');

    // 依赖转 anonymous 后，根才能匿名开放。
    expect((await setVisibility('dep', 'anonymous')).statusCode).toBe(200);
    expect((await setVisibility('root', 'anonymous')).statusCode).toBe(200);
  });

  it('blocks tightening a dependency that still backs an anonymous published skill', async () => {
    await upload('dep');
    expect((await publish('dep', '1.0.0')).statusCode).toBe(201);
    await upload('root');
    expect((await publish('root', '1.0.0', { '@alice/dep': '*' })).statusCode).toBe(201);
    expect((await setVisibility('dep', 'anonymous')).statusCode).toBe(200);
    expect((await setVisibility('root', 'anonymous')).statusCode).toBe(200);

    for (const target of ['public', 'private']) {
      const blocked = await setVisibility('dep', target);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().code).toBe('anonymousDependentsRequireAnonymousVisibility');
      expect(blocked.json().params.dependents).toContain('@alice/root');
    }
  });

  it('keeps new skills private by default', async () => {
    await upload('fresh');
    const detail = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/fresh',
      headers: { authorization: 'token alice-token' }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().visibility).toBe('private');

    const anonymousSearch = await app.inject({ method: 'GET', url: '/api/skills/search' });
    expect(anonymousSearch.json()).toEqual([]);
  });

  it('checks the transitive chain, not just direct dependencies, when switching to anonymous', async () => {
    await upload('leaf');
    expect((await publish('leaf', '1.0.0')).statusCode).toBe(201);
    await upload('mid');
    expect((await publish('mid', '1.0.0', { '@alice/leaf': '*' })).statusCode).toBe(201);
    await upload('root');
    expect((await publish('root', '1.0.0', { '@alice/mid': '*' })).statusCode).toBe(201);

    // 叶子匿名不代表整链匿名：中间层仍会让匿名安装断在半路。
    expect((await setVisibility('leaf', 'anonymous')).statusCode).toBe(200);
    const blocked = await setVisibility('root', 'anonymous');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().params.dependencies).toContain('@alice/mid');

    expect((await setVisibility('mid', 'anonymous')).statusCode).toBe(200);
    expect((await setVisibility('root', 'anonymous')).statusCode).toBe(200);
  });

  it('keeps validating historical releases that are still installable', async () => {
    await upload('dep');
    expect((await publish('dep', '1.0.0')).statusCode).toBe(201);
    await upload('root');
    // 1.0.0 依赖 private 的 dep；2.0.0 去掉依赖，但旧版本仍可安装。
    expect((await publish('root', '1.0.0', { '@alice/dep': '*' })).statusCode).toBe(201);
    expect((await publish('root', '2.0.0')).statusCode).toBe(201);

    const blocked = await setVisibility('root', 'anonymous');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().params.dependencies).toContain('@alice/dep');
  });

  it('blocks tightening a dependency still referenced by an older anonymous release', async () => {
    await upload('dep');
    expect((await publish('dep', '1.0.0')).statusCode).toBe(201);
    await upload('root');
    expect((await publish('root', '1.0.0', { '@alice/dep': '*' })).statusCode).toBe(201);
    expect((await setVisibility('dep', 'anonymous')).statusCode).toBe(200);
    expect((await setVisibility('root', 'anonymous')).statusCode).toBe(200);
    // 新版本不再依赖 dep，但 1.0.0 的冻锁仍然指向它。
    expect((await publish('root', '2.0.0')).statusCode).toBe(201);

    const blocked = await setVisibility('dep', 'private');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('anonymousDependentsRequireAnonymousVisibility');
    expect(blocked.json().params.dependents).toContain('@alice/root');
  });

  it('rejects publishing a new anonymous release whose dependency chain is not anonymous', async () => {
    await upload('dep');
    expect((await publish('dep', '1.0.0')).statusCode).toBe(201);
    await upload('root');
    // 还没有任何 Release 时切换到 anonymous 是允许的；发布时才解析全链。
    expect((await setVisibility('root', 'anonymous')).statusCode).toBe(200);

    const response = await publish('root', '1.0.0', { '@alice/dep': '*' });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('releaseDependencyAnonymousChainMustBeAnonymous');
  });
});
