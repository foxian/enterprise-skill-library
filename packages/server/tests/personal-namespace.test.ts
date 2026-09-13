import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, TenantOrganizationRepository } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';
import { validateReleaseManifest } from '@esl/core';

// 个人命名空间发布端到端（ADR-0032 / #53）：release.json v3 的 name 是归属的
// 唯一权威来源；首次 upload 按它在对应所有者名下建仓库并固定身份；publish 只断言。
describe('personal namespace publish', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-personal-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'mallory', password: 'mallory-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.setOrgOwner('acme', 'alice');
    gitea.__state.addOrgMember('acme', 'alice');

    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'active' });
    db.close();
    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });

    // alice 的登录 token
    gitea.validateToken.mockImplementation(async (token: string) =>
      token === 'alice-token' ? { id: 1, username: 'alice', email: 'alice@local.esl' } : null
    );
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const upload = (name: string, description = 'A skill') =>
    app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name, description }
    });

  it('fixes identity at first upload under the uploader personal namespace for a bare name', async () => {
    const res = await upload('reviewer');

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: '@alice/reviewer',
      scope: 'alice',
      skillName: 'reviewer',
      owner: 'alice'
    });
    // 个人技能 = 个人仓库
    expect(gitea.createRepo).toHaveBeenCalledWith('alice', 'reviewer', true);
    expect(res.json().gitRepoPath ?? `alice/reviewer`).toBe('alice/reviewer');
  });

  it('treats an explicit @own-username/skill name as equivalent to the bare name', async () => {
    const res = await upload('@alice/reviewer');

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: '@alice/reviewer', scope: 'alice' });
    expect(gitea.createRepo).toHaveBeenCalledWith('alice', 'reviewer', true);
  });

  it('rejects uploading into a namespace the uploader does not hold', async () => {
    gitea.validateToken.mockImplementation(async (token: string) =>
      token === 'mallory-token' ? { id: 2, username: 'mallory', email: 'mallory@local.esl' } : null
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token mallory-token' },
      payload: { name: '@alice/stolen', description: 'Stolen skill' }
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('alice');
  });

  it('publishes when the manifest name matches the established identity (bare form included)', async () => {
    await upload('@alice/reviewer');
    const manifest = {
      schemaVersion: 3,
      name: 'reviewer',
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    };
    gitea.readSourceTree.mockResolvedValue({
      'SKILL.md': '---\nname: reviewer\n---\n',
      'release.json': JSON.stringify(manifest)
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: { version: '1.0.0', sourceCommit: 'abc123', releaseManifest: manifest }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: '1.0.0' });
  });

  it('refuses a publish whose manifest name does not match the established identity', async () => {
    await upload('@alice/reviewer');
    const manifest = {
      schemaVersion: 3,
      name: '@alice/renamed',
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: { version: '1.0.0', sourceCommit: 'abc123', releaseManifest: manifest }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('name');
    expect(res.json().error).toContain('@alice/reviewer');
  });

  it('rejects a v2 manifest at publish time with the upgrade hint', async () => {
    await upload('@alice/reviewer');
    const manifest = {
      schemaVersion: 2,
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases',
      headers: { authorization: 'token alice-token' },
      payload: { version: '1.0.0', sourceCommit: 'abc123', releaseManifest: manifest }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('schemaVersion to 3');
  });
});
