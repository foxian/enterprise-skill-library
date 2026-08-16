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
      headers: { host: 'localhost:3000', authorization: 'token valid-token' },
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
    expect(createRes.json().cloneUrl).toBe('http://localhost:3000/git/esl-skills/alice_code-review.git');
    expect(createRes.json()).toMatchObject({
      createdBy: 'zhangsan',
      owner: 'platform',
      maintainers: ['zhangsan']
    });

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/code-review',
      headers: { host: 'localhost:3000' }
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.name).toBe('@alice/code-review');
    expect(body.gitRepoPath).toBe('esl-skills/alice_code-review');
    expect(body.cloneUrl).toBe('http://localhost:3000/git/esl-skills/alice_code-review.git');
  });

  it('exposes author-published releases for another user to discover and inspect', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockImplementation(async (token: string) => {
        if (token === 'author-token') return { username: 'author' };
        if (token === 'consumer-token') return { username: 'consumer' };
        return null;
      }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'esl-skills/author_demo' })
    };

    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    for (const version of ['0.1.0', '0.1.1']) {
      const publishRes = await app.inject({
        method: 'POST',
        url: '/api/skills',
        headers: { host: 'localhost:3000', authorization: 'token author-token' },
        payload: {
          name: '@author/demo',
          version,
          description: 'Shared demo skill'
        }
      });

      expect(publishRes.statusCode).toBe(201);
      expect(publishRes.json().cloneUrl).toBe('http://localhost:3000/git/esl-skills/author_demo.git');
    }

    expect(mockGitea.createOrganizationRepo).toHaveBeenCalledTimes(1);

    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=demo',
      headers: { host: 'localhost:3000', authorization: 'token consumer-token' }
    });
    expect(searchRes.statusCode).toBe(200);
    expect(searchRes.json()).toEqual([
      expect.objectContaining({
        name: '@author/demo',
        createdBy: 'author',
        gitRepoPath: 'esl-skills/author_demo'
      })
    ]);

    const infoRes = await app.inject({
      method: 'GET',
      url: '/api/skills/@author/demo',
      headers: { host: 'localhost:3000', authorization: 'token consumer-token' }
    });
    expect(infoRes.statusCode).toBe(200);
    expect(infoRes.json()).toMatchObject({
      name: '@author/demo',
      createdBy: 'author',
      cloneUrl: 'http://localhost:3000/git/esl-skills/author_demo.git',
      versions: ['0.1.1', '0.1.0']
    });
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

  it('creates a user with a generated initial password shown exactly once', async () => {
    const mockGitea = {
      createUser: vi.fn().mockResolvedValue(undefined)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token bootstrap-token' },
      payload: { username: 'alice' }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.username).toBe('alice');
    expect(body.disabled).toBe(false);
    expect(typeof body.password).toBe('string');
    expect(body.password).not.toBe('');
    expect(mockGitea.createUser).toHaveBeenCalledTimes(1);
    expect(mockGitea.createUser).toHaveBeenCalledWith('alice', body.password);
  });

  it('creates a user with an administrator-supplied initial password without echoing it', async () => {
    const mockGitea = {
      createUser: vi.fn().mockResolvedValue(undefined)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token bootstrap-token' },
      payload: { username: 'alice', password: 'custom-password' }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.username).toBe('alice');
    expect(body).not.toHaveProperty('password');
    expect(mockGitea.createUser).toHaveBeenCalledWith('alice', 'custom-password');
  });

  it('rejects user creation without a platform administrator token', async () => {
    const mockGitea = {
      createUser: vi.fn(),
      validateAdminUserToken: vi.fn().mockResolvedValue(null)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token ordinary-user-token' },
      payload: { username: 'alice' }
    });

    expect(res.statusCode).toBe(403);
    expect(mockGitea.createUser).not.toHaveBeenCalled();
  });

  it('logs in through the ESL Server and registers the returned Skill User Token', async () => {
    const mockGitea = {
      loginUser: vi.fn().mockResolvedValue('skill-user-token'),
      createUser: vi.fn().mockResolvedValue(undefined),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'esl-skills/alice_demo' })
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: 'token bootstrap-token' },
      payload: { username: 'alice' }
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({ token: 'skill-user-token', username: 'alice' });
    expect(mockGitea.loginUser).toHaveBeenCalledWith('alice', 'correct-password');

    const createSkillRes = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: 'token skill-user-token' },
      payload: {
        name: '@alice/demo',
        version: '0.1.0',
        description: 'Demo skill'
      }
    });

    expect(createSkillRes.statusCode).toBe(201);
    expect(createSkillRes.json().createdBy).toBe('alice');
  });

  it('logs in a Gitea user who is not yet recorded in the ESL database', async () => {
    const mockGitea = {
      loginUser: vi.fn().mockResolvedValue('gitea-token'),
      validateToken: vi.fn().mockResolvedValue({ username: 'eslroot' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'esl-skills/eslroot_demo' })
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'eslroot', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({ token: 'gitea-token', username: 'eslroot' });

    const createSkillRes = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: 'token gitea-token' },
      payload: {
        name: '@eslroot/demo',
        version: '0.1.0',
        description: 'Demo skill'
      }
    });

    expect(createSkillRes.statusCode).toBe(201);
  });

  it('rejects invalid ESL Server login credentials without issuing a token', async () => {
    const mockGitea = {
      loginUser: vi.fn().mockResolvedValue(null)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',      url: '/api/auth/login',
      payload: { username: 'alice', password: 'wrong-password' }
    });

    expect(loginRes.statusCode).toBe(401);
    expect(loginRes.json()).toEqual({ error: 'Unauthorized: invalid credentials' });
  });

  it('lets an authenticated Skill User change their own password with their current password', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      validateUserPassword: vi.fn().mockResolvedValue(true),
      changeUserPassword: vi.fn().mockResolvedValue(undefined)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { authorization: 'token alice-token' },
      payload: { oldPassword: 'current-password', newPassword: 'new-password' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ passwordChanged: true });
    expect(mockGitea.validateToken).toHaveBeenCalledWith('alice-token');
    expect(mockGitea.validateUserPassword).toHaveBeenCalledWith('alice', 'current-password');
    expect(mockGitea.changeUserPassword).toHaveBeenCalledWith('alice', 'new-password');
  });

  it('rejects a self-service password change when the current password is wrong', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      validateUserPassword: vi.fn().mockResolvedValue(false),
      changeUserPassword: vi.fn()
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { authorization: 'token alice-token' },
      payload: { oldPassword: 'wrong-password', newPassword: 'new-password' }
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized: current password is incorrect' });
    expect(mockGitea.changeUserPassword).not.toHaveBeenCalled();
  });

  it('rejects a self-service password change without a valid Skill User Token', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue(null),
      changeUserPassword: vi.fn()
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { authorization: 'token invalid-token' },
      payload: { oldPassword: 'current-password', newPassword: 'new-password' }
    });

    expect(res.statusCode).toBe(401);
    expect(mockGitea.changeUserPassword).not.toHaveBeenCalled();
  });

  it('lets an administrator reset a user password with a generated one shown once', async () => {
    const mockGitea = {
      changeUserPassword: vi.fn().mockResolvedValue(undefined)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/password',
      headers: { authorization: 'token bootstrap-token' },
      payload: {}
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe('alice');
    expect(typeof body.password).toBe('string');
    expect(body.password).not.toBe('');
    expect(mockGitea.changeUserPassword).toHaveBeenCalledTimes(1);
    expect(mockGitea.changeUserPassword).toHaveBeenCalledWith('alice', body.password);
  });

  it('lets an administrator reset a user password with a supplied one without echoing it', async () => {
    const mockGitea = {
      changeUserPassword: vi.fn().mockResolvedValue(undefined)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/password',
      headers: { authorization: 'token bootstrap-token' },
      payload: { password: 'supplied-password' }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe('alice');
    expect(body).not.toHaveProperty('password');
    expect(mockGitea.changeUserPassword).toHaveBeenCalledWith('alice', 'supplied-password');
  });

  it('rejects resetting a user password without a platform administrator token', async () => {
    const mockGitea = {
      changeUserPassword: vi.fn(),
      validateAdminUserToken: vi.fn().mockResolvedValue(null)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/alice/password',
      headers: { authorization: 'token ordinary-user-token' },
      payload: {}
    });

    expect(res.statusCode).toBe(403);
    expect(mockGitea.changeUserPassword).not.toHaveBeenCalled();
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
