import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 全局身份登录（ADR-0032 / ADR-0036）：username + password 一条凭据，无组织字段；
// 所属组织列表由 Gitea 成员关系派生，组织内身份逐组织声明（普通成员 / 管理成员 /
// 所有者成员），服务端不派生全局角色。
describe('global identity login', () => {
  let tmpDir: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-global-login-'));
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'bob', password: 'bob-password' },
        { username: 'carol', password: 'carol-password' }
      ],
      orgs: [{ name: 'acme', teams: [] }, { name: 'beta', teams: [] }]
    });
    gitea.__state.setOrgOwner('beta', 'alice');
    gitea.__state.addOrgMember('acme', 'alice');
    gitea.__state.addOrgMember('acme', 'bob');
    // carol: 注册但未加入任何组织

    const db = initDatabase(path.join(tmpDir, 'test.db'));
    db.close();
    app = await buildApp({ dbPath: path.join(tmpDir, 'test.db'), giteaService: gitea as any, repoOwner: 'esl-skills' });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logs in with a bare username and password, returning derived organizations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'alice-password' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      token: expect.any(String),
      username: 'alice',
      locale: null,
      organizations: [
        { org: 'acme', identity: 'ordinary', isOwnerMember: false },
        { org: 'beta', identity: 'owner', isOwnerMember: true }
      ]
    });
  });

  it('returns an empty organization list for a user with no memberships', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'carol', password: 'carol-password' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().organizations).toEqual([]);
  });

  it('rejects bad credentials and missing fields', async () => {
    const badPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'wrong' }
    });
    expect(badPassword.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice' }
    });
    expect(missing.statusCode).toBe(400);
  });

  it('rejects the platform administrator from the CLI login', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'eslroot', password: 'whatever' }
    });

    expect(response.statusCode).toBe(403);
  });

  it('signs the platform administrator in through the console as the platform admin, outside any organization', async () => {
    gitea.__state.users.set('eslroot', 'root-password');
    const response = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'eslroot', password: 'root-password' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ username: 'eslroot', isPlatformAdmin: true, organizations: [] });
  });

  it('signs a user in through the console with per-organization identity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'alice', password: 'alice-password' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      username: 'alice',
      isPlatformAdmin: false,
      organizations: [
        { org: 'acme', identity: 'ordinary', isOwnerMember: false },
        { org: 'beta', identity: 'owner', isOwnerMember: true }
      ]
    });
  });

  it('issues tokens that validate back to the global username', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'bob', password: 'bob-password' }
    });
    const { token } = login.json() as { token: string };

    const who = await gitea.validateToken(token);
    expect(who?.username).toBe('bob');
  });
});
