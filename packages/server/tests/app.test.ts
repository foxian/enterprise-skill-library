import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Fastify Server API', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-app-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers and retrieves a skill', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'zhangsan' }),
      createRepo: vi.fn().mockResolvedValue({ full_name: 'myorg/my-skill' })
    };

    app = buildApp({ dbPath, giteaService: mockGitea as any });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: 'token valid-token' },
      payload: {
        name: '@myorg/my-skill',
        version: '0.1.0',
        description: 'Test skill',
        author: 'zhangsan'
      }
    });

    expect(createRes.statusCode).toBe(201);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/skills/@myorg/my-skill'
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.name).toBe('@myorg/my-skill');
  });
});
