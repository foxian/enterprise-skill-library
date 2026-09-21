import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// API 错误契约（ADR-0044）：{ code, params, message }；code 稳定，message 固定英文兜底。
describe('api error contract', () => {
  let tmpDir: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-api-error-'));
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

  it('登录缺少字段时返回 code/params/message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice' }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('usernameAndPasswordAreRequired');
    expect(body.params).toEqual({});
    expect(body.message).toBe('Username and password are required');
    expect(body.error).toBeUndefined();
  });

  it('凭据错误返回稳定 code 与固定英文 message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'wrong' }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.code).toBeTypeOf('string');
    expect(body.message).toBeTypeOf('string');
  });

  it('平台管理员走 CLI 登录被拒时返回稳定 code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'eslroot', password: 'whatever' }
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.code).toBeTypeOf('string');
    expect(body.message).toBe('Platform administrators sign in from the Admin Console');
  });
});
