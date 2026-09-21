import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// 账户语言偏好（ADR-0044）：locale 可为 null，登录响应返回，独立偏好读写接口。
describe('account locale preference', () => {
  let tmpDir: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-account-locale-'));
    gitea = createGlobalGitea({
      users: [{ username: 'alice', password: 'alice-password' }]
    });
    const db = initDatabase(path.join(tmpDir, 'test.db'));
    db.close();
    app = await buildApp({ dbPath: path.join(tmpDir, 'test.db'), giteaService: gitea as any, repoOwner: 'esl-skills' });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function login(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'alice-password' }
    });
    return response.json().token;
  }

  it('登录响应携带未设置的 locale（null）', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'alice-password' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().locale).toBeNull();
  });

  it('偏好接口保存并返回账户 locale', async () => {
    const token = await login();

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/account/preferences',
      headers: { authorization: `token ${token}` },
      payload: { locale: 'zh-CN' }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ locale: 'zh-CN' });

    const fetched = await app.inject({
      method: 'GET',
      url: '/api/account/preferences',
      headers: { authorization: `token ${token}` }
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual({ locale: 'zh-CN' });

    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'alice-password' }
    });
    expect(again.json().locale).toBe('zh-CN');
  });

  it('偏好接口可以把 locale 重置为 null', async () => {
    const token = await login();
    await app.inject({
      method: 'PUT',
      url: '/api/account/preferences',
      headers: { authorization: `token ${token}` },
      payload: { locale: 'zh-CN' }
    });

    const reset = await app.inject({
      method: 'PUT',
      url: '/api/account/preferences',
      headers: { authorization: `token ${token}` },
      payload: { locale: null }
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ locale: null });
  });

  it('拒绝不受支持的 locale', async () => {
    const token = await login();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/account/preferences',
      headers: { authorization: `token ${token}` },
      payload: { locale: 'fr-FR' }
    });
    expect(response.statusCode).toBe(400);
  });

  it('未认证时偏好接口返回 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/account/preferences'
    });
    expect(response.statusCode).toBe(401);
  });
});
