import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';

// 技能显示名（ADR-0048 / #72）：对外「当前显示名」解析规则——
// 1) 曾发布 → 取最近一次 Skill Release（按发布时间，含预发布）快照的 displayName，
//    缺失或为空回退 Identity 短名（不读后续脏 upload）；
// 2) 从未发布（active-unreleased）→ 取 upload 同步到服务器的当前源码 displayName；
// 3) 仍未设置 → Identity 短名原文（运行时不做 Title Case）。
// 另覆盖 PUT /display-name（Maintainer 直改当前源码值）与 search 匹配显示名。
describe('skill display name', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-display-name-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      createRepo: vi.fn().mockResolvedValue({ full_name: 'alice/markdown-master' }),
      createReleaseTag: vi.fn().mockResolvedValue(undefined),
      getReleaseTag: vi.fn().mockResolvedValue(null),
      deleteReleaseTag: vi.fn().mockResolvedValue(undefined),
      validateAdminUserToken: vi.fn().mockResolvedValue(null)
    };
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'platform-ai', status: 'active' });
    db.close();
    app = buildApp({
      dbPath,
      packageRoot: path.join(tmpDir, 'packages'),
      giteaService: gitea as any,
      repoOwner: 'platform-ai'
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function upload(displayName?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'markdown-master', description: 'Markdown 技能', displayName }
    });
  }

  function manifest(displayName?: string) {
    const m: Record<string, unknown> = {
      schemaVersion: 4,
      name: '@alice/markdown-master',
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    };
    if (displayName !== undefined) m.displayName = displayName;
    return m;
  }

  async function publish(version: string, displayName?: string) {
    const m = manifest(displayName);
    return app.inject({
      method: 'POST',
      url: '/api/skills/@alice/markdown-master/releases',
      headers: { authorization: 'token alice-token' },
      payload: {
        version,
        sourceCommit: `commit-${version}`,
        releaseManifest: m,
        files: {
          'SKILL.md': '---\nname: markdown-master\ndescription: Markdown 技能\n---\n',
          'release.json': JSON.stringify(m)
        }
      }
    });
  }

  async function search(q: string) {
    return app.inject({
      method: 'GET',
      url: `/api/skills/search?q=${encodeURIComponent(q)}`,
      headers: { authorization: 'token alice-token' }
    });
  }

  async function inventory() {
    return app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token alice-token' }
    });
  }

  it('从未发布时对外显示名取 upload 同步的当前源码 displayName（inventory/info）', async () => {
    await upload('Markdown Master');
    const inv = await inventory();
    expect(inv.statusCode).toBe(200);
    expect(inv.json()).toEqual([
      expect.objectContaining({ name: '@alice/markdown-master', displayName: 'Markdown Master' })
    ]);
    // 未发布技能不进入 search（ADR-0048 / ADR-0049）。
    expect((await search('master')).json()).toEqual([]);
    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/markdown-master',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.json().displayName).toBe('Markdown Master');
  });

  it('从未发布且无 displayName 时回退 Identity 短名', async () => {
    await upload();
    const inv = await inventory();
    expect(inv.json()[0].displayName).toBe('markdown-master');
  });

  it('有发布后对外显示名取最近发布快照，不被后续脏 upload 改写', async () => {
    await upload('Markdown Master');
    await publish('1.0.0', 'Markdown 排版大师');
    // 再 upload 脏值：未发布当前值变了，但对外标题仍来自最近 Release 快照。
    await upload('脏的源码显示名');
    let res = await search('master');
    expect(res.json()[0].displayName).toBe('Markdown 排版大师');
    // 再发布新版 → 对外标题跟随最近发布。
    await publish('1.1.0', 'Markdown 终极版');
    res = await search('master');
    expect(res.json()[0].displayName).toBe('Markdown 终极版');
  });

  it('最近发布含预发布：预发布快照的 displayName 也优先', async () => {
    await upload('Markdown Master');
    await publish('1.0.0', 'Markdown 稳定名');
    await publish('1.1.0-beta.1', 'Markdown 预发布名');
    const res = await search('master');
    expect(res.json()[0].displayName).toBe('Markdown 预发布名');
  });

  it('release 快照缺失或为空时回退短名，不读 upload 脏值', async () => {
    await upload('源码显示名');
    // 发布清单不带 displayName → 对外回退短名。
    await publish('1.0.0');
    let res = await search('master');
    expect(res.json()[0].displayName).toBe('markdown-master');
    // 快照显式空串同样回退短名。
    await publish('1.1.0', '');
    res = await search('master');
    expect(res.json()[0].displayName).toBe('markdown-master');
  });

  it('search 可匹配 displayName 关键词', async () => {
    await upload('Markdown Master');
    await publish('1.0.0', 'Markdown 排版大师');
    const hit = await search('排版大师');
    expect(hit.json()).toEqual([
      expect.objectContaining({ name: '@alice/markdown-master', displayName: 'Markdown 排版大师' })
    ]);
  });

  it('PUT /display-name：Maintainer 直改当前源码值（从未发布时成为对外显示名）', async () => {
    await upload('Markdown Master');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/skills/@alice/markdown-master/display-name',
      headers: { authorization: 'token alice-token' },
      payload: { displayName: 'Markdown 直改名' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: '@alice/markdown-master', displayName: 'Markdown 直改名' });
    const inv = await inventory();
    expect(inv.json()[0].displayName).toBe('Markdown 直改名');
    const db = initDatabase(dbPath);
    expect(new SkillRepository(db).getSkill('@alice/markdown-master')?.displayName).toBe('Markdown 直改名');
    db.close();
  });

  it('PUT /display-name：超长 400、不存在 404、非 Maintainer 403、空串清空', async () => {
    await upload('Markdown Master');
    const tooLong = await app.inject({
      method: 'PUT',
      url: '/api/skills/@alice/markdown-master/display-name',
      headers: { authorization: 'token alice-token' },
      payload: { displayName: 'x'.repeat(129) }
    });
    expect(tooLong.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'PUT',
      url: '/api/skills/@alice/nope/display-name',
      headers: { authorization: 'token alice-token' },
      payload: { displayName: 'Nope' }
    });
    expect(missing.statusCode).toBe(404);

    // zoe 无 manage 权 → 403。
    gitea.validateToken.mockResolvedValue({ username: 'zoe' });
    const forbidden = await app.inject({
      method: 'PUT',
      url: '/api/skills/@alice/markdown-master/display-name',
      headers: { authorization: 'token zoe-token' },
      payload: { displayName: 'Hacked' }
    });
    expect(forbidden.statusCode).toBe(403);

    // 空串/纯空白即清空，回退短名。
    gitea.validateToken.mockResolvedValue({ username: 'alice' });
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/skills/@alice/markdown-master/display-name',
      headers: { authorization: 'token alice-token' },
      payload: { displayName: '   ' }
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().displayName).toBeNull();
    const inv = await inventory();
    expect(inv.json()[0].displayName).toBe('markdown-master');
  });

  it('已发布后 PUT /display-name 只改当前源码值，对外标题仍由最近发布快照决定', async () => {
    await upload('Markdown Master');
    await publish('1.0.0', 'Markdown 快照名');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/skills/@alice/markdown-master/display-name',
      headers: { authorization: 'token alice-token' },
      payload: { displayName: 'Markdown 直改名' }
    });
    expect(res.statusCode).toBe(200);
    const hit = await search('master');
    expect(hit.json()[0].displayName).toBe('Markdown 快照名');
  });

  it('upload 带超长 displayName 被 400 拒绝', async () => {
    const res = await upload('x'.repeat(129));
    expect(res.statusCode).toBe(400);
  });
});
