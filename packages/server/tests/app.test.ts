import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { GiteaService } from '../src/services/gitea.js';

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
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'esl-skills/alice_code-review' })
    };

    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: 'token valid-token' },
      payload: {
        name: '@alice/code-review',
        version: '0.1.0',
        description: 'Test skill',
        author: 'zhangsan'
      }
    });

    expect(createRes.statusCode).toBe(201);
    expect(mockGitea.createOrganizationRepo).toHaveBeenCalledWith(
      'esl-skills',
      'alice_code-review',
      false
    );
    expect(createRes.json().gitRepoPath).toBe('esl-skills/alice_code-review');
    expect(createRes.json()).toMatchObject({
      createdBy: 'zhangsan',
      owner: 'platform',
      maintainers: ['zhangsan']
    });

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/code-review'
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.name).toBe('@alice/code-review');
    expect(body.gitRepoPath).toBe('esl-skills/alice_code-review');
  });

  it('responds to health checks without requiring Gitea', async () => {
    const mockGitea = {
      validateToken: vi.fn(),
      createOrganizationRepo: vi.fn()
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'esl-api' });
    expect(mockGitea.validateToken).not.toHaveBeenCalled();
  });

  it('builds the app with the resolved Gitea admin token', () => {
    const giteaService = new GiteaService('http://gitea:3000', 'admin-token');
    app = buildApp({
      dbPath,
      giteaService,
      repoOwner: 'esl-skills',
      bootstrapAdminToken: 'bootstrap-token'
    });

    expect(app).toBeDefined();
  });
});
