import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { GiteaService } from '../src/services/gitea.js';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';

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

  it('does not seed sample skill metadata by default', async () => {
    const mockGitea = { validateToken: vi.fn(), createOrganizationRepo: vi.fn() };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const db = initDatabase(dbPath);
    try {
      const repo = new SkillRepository(db);
      expect(repo.getSkill('@myorg/my-skill')).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('seeds sample skill metadata when autoSeed is enabled', async () => {
    const mockGitea = { validateToken: vi.fn(), createOrganizationRepo: vi.fn() };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills', autoSeed: true });

    const db = initDatabase(dbPath);
    try {
      const repo = new SkillRepository(db);
      expect(repo.getSkill('@myorg/my-skill')).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('search does not 500 when a skill repo is missing in Gitea (orphan record)', async () => {
    // 模拟 Gitea:用户有效,但仓库/组织相关查询全部 404
    const mockFetch = vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).includes('/user')) {
        return { ok: true, json: async () => ({ id: 1, username: 'foxian_admin', email: 'foxian_admin@local.esl' }) };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    });
    const giteaService = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);
    app = buildApp({ dbPath, giteaService: giteaService as any, repoOwner: 'esl-skills' });
    const db = initDatabase(dbPath);
    new SkillRepository(db).createSkill({
      name: '@myorg/my-skill',
      scope: 'myorg',
      skillName: 'my-skill',
      description: 'orphan',
      createdBy: 'dev',
      owner: 'platform',
      maintainers: ['dev'],
      visibility: 'private',
      gitRepoPath: 'myorg/my-skill'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=',
      headers: { authorization: 'token foxian-token' }
    });
    expect(res.statusCode).toBe(200);
    // 孤儿技能对 foxian_admin 无读权限,被过滤而非 500
    expect(JSON.parse(res.body)).toEqual([]);
    db.close();
  });

  it('permissions returns an empty matrix instead of 500 when the repo is missing', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).includes('/user')) {
        return { ok: true, json: async () => ({ id: 1, username: 'foxian_admin', email: 'foxian_admin@local.esl' }) };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    });
    const giteaService = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);
    app = buildApp({ dbPath, giteaService: giteaService as any, repoOwner: 'esl-skills' });
    const db = initDatabase(dbPath);
    new SkillRepository(db).createSkill({
      name: '@foxian/ghost-skill',
      scope: 'foxian',
      skillName: 'ghost-skill',
      description: 'orphan',
      createdBy: 'foxian_admin',
      owner: 'foxian_admin',
      maintainers: ['foxian_admin'],
      visibility: 'private',
      gitRepoPath: 'foxian/ghost-skill'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/foxian/ghost-skill/permissions',
      headers: { authorization: 'token foxian-token' }
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      scope: 'foxian',
      skillName: 'ghost-skill',
      sharedAllRead: false,
      sharedAllWrite: false,
      teams: [],
      members: []
    });
    db.close();
  });

  it('registers and retrieves a skill', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'zhangsan' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'alice/alice_code-review' })
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
      'alice',
      'alice_code-review',
      false
    );
    expect(createRes.json().gitRepoPath).toBe('alice/alice_code-review');
    expect(createRes.json().cloneUrl).toBe('http://localhost:3000/git/alice/alice_code-review.git');
    expect(createRes.json()).toMatchObject({
      createdBy: 'zhangsan',
      owner: 'platform',
      maintainers: ['zhangsan']
    });

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/skills/@alice/code-review',
      headers: { host: 'localhost:3000', authorization: 'token valid-token' }
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.name).toBe('@alice/code-review');
    expect(body.gitRepoPath).toBe('alice/alice_code-review');
    expect(body.cloneUrl).toBe('http://localhost:3000/git/alice/alice_code-review.git');
  });

  it('uploads a server-hosted skill without creating a release', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' })
    };

    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { host: 'localhost:3000', authorization: 'token alice-token' },
      payload: {
        name: 'reviewer',
        description: 'Shared reviewer'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: '@platform-ai/reviewer',
      status: 'active-unreleased',
      createdBy: 'alice',
      maintainers: ['alice'],
      versions: []
    });
    expect(response.json().skillId).toMatch(/^sk_/);
    expect(mockGitea.createOrganizationRepo).toHaveBeenCalledWith('platform-ai', 'reviewer', true);
  });

  it('grants an authenticated user read access before source checkout', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'consumer' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' }),
      addCollaborator: vi.fn().mockResolvedValue(undefined)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token consumer-token' },
      payload: { name: 'reviewer', description: 'Reviewer' }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/source-access',
      headers: { authorization: 'token consumer-token', host: 'localhost:3000' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().cloneUrl).toBe('http://localhost:3000/git/platform-ai/reviewer.git');
    expect(mockGitea.addCollaborator).toHaveBeenCalledWith(
      'platform-ai',
      'reviewer',
      'consumer',
      'read'
    );
  });

  it('renames a skill while preserving its Skill ID and creates a redirect', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' }),
      renameRepo: vi.fn().mockResolvedValue(undefined)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });

    const upload = await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { host: 'localhost:3000', authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Reviewer' }
    });
    const skillId = upload.json().skillId;

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/rename',
      headers: { host: 'localhost:3000', authorization: 'token alice-token' },
      payload: { name: 'reviewer-pro' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: '@platform-ai/reviewer-pro', skillId });
    expect(mockGitea.renameRepo).toHaveBeenCalledWith('platform-ai', 'reviewer', 'reviewer-pro');
    expect((await app.inject({ method: 'GET', url: '/api/skills/@platform-ai/reviewer' })).statusCode).toBe(301);
  });

  it('rejects a rename that would reuse an existing skill identity before touching Gitea', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      createOrganizationRepo: vi.fn()
        .mockResolvedValueOnce({ full_name: 'platform-ai/reviewer' })
        .mockResolvedValueOnce({ full_name: 'platform-ai/other' }),
      renameRepo: vi.fn().mockResolvedValue(undefined),
      updateSkillName: vi.fn().mockResolvedValue(undefined)
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });
    for (const name of ['reviewer', 'other']) {
      await app.inject({
        method: 'POST',
        url: '/api/skills/upload',
        headers: { authorization: 'token alice-token' },
        payload: { name, description: name }
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/rename',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'other' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('already exists');
    expect(mockGitea.updateSkillName).not.toHaveBeenCalled();
    expect(mockGitea.renameRepo).not.toHaveBeenCalled();
  });

  it('attempts to roll back source metadata when repository rename fails', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' }),
      updateSkillName: vi.fn().mockResolvedValue(undefined),
      renameRepo: vi.fn().mockRejectedValue(new Error('backend unavailable'))
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Reviewer' }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/rename',
      headers: { authorization: 'token alice-token' },
      payload: { name: 'reviewer-pro' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ retryable: true });
    expect(mockGitea.updateSkillName).toHaveBeenNthCalledWith(
      2,
      'platform-ai',
      'reviewer-pro',
      'reviewer'
    );
    expect((await app.inject({ method: 'GET', url: '/api/skills/@platform-ai/reviewer', headers: { authorization: 'token alice-token' } })).statusCode).toBe(200);
  });

  it('archives a skill and only a platform administrator can restore it', async () => {
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'alice' }),
      validateAdminUserToken: vi.fn().mockResolvedValue(null),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'platform-ai/reviewer' })
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });
    await app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: { host: 'localhost:3000', authorization: 'token alice-token' },
      payload: { name: 'reviewer', description: 'Reviewer' }
    });

    const archive = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/archive',
      headers: { authorization: 'token alice-token' }
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().status).toBe('archived');

    const restore = await app.inject({
      method: 'POST',
      url: '/api/skills/@platform-ai/reviewer/restore',
      headers: { authorization: 'token alice-token' }
    });
    expect(restore.statusCode).toBe(403);
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

  it('blocks skill access while a tenant is provisioning', async () => {
    const db = initDatabase(dbPath);
    new TenantOrganizationRepository(db).create({ orgName: 'acme', status: 'provisioning' });
    db.close();
    const mockGitea = {
      validateToken: vi.fn().mockResolvedValue({ username: 'acme_admin' })
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/acme/missing',
      headers: { authorization: 'token token' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: 'provisioning' });
    expect(mockGitea.validateToken).not.toHaveBeenCalled();
  });

  it('logs in an organization member through the CLI endpoint and registers the returned token', async () => {
    const mockGitea = {
      loginUser: vi.fn().mockResolvedValue('skill-user-token'),
      listOrgMembers: vi.fn().mockResolvedValue([{ username: 'acme_alice' }]),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'acme/alice_demo' })
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { org: 'acme', username: 'alice', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({ token: 'skill-user-token', username: 'alice', org: 'acme', role: 'member' });
    expect(mockGitea.loginUser).toHaveBeenCalledWith('acme_alice', 'correct-password');
    expect(mockGitea.listOrgMembers).toHaveBeenCalledWith('acme');

    const createSkillRes = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: 'token skill-user-token' },
      payload: {
        name: '@acme/demo',
        version: '0.1.0',
        description: 'Demo skill'
      }
    });

    expect(createSkillRes.statusCode).toBe(201);
    expect(createSkillRes.json().createdBy).toBe('acme_alice');
  });

  it('logs in an organization administrator through the CLI endpoint with the org-admin role', async () => {
    const mockGitea = {
      loginUser: vi.fn().mockResolvedValue('admin-token'),
      listOrgMembers: vi.fn().mockResolvedValue([{ username: 'acme_admin' }])
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { org: 'acme', username: 'admin', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({ token: 'admin-token', username: 'admin', org: 'acme', role: 'org-admin' });
  });

  it('logs in the platform administrator through the Admin Console endpoint', async () => {
    const mockGitea = {
      loginUser: vi.fn().mockResolvedValue('gitea-token'),
      adminUsername: 'eslroot',
      validateToken: vi.fn().mockResolvedValue({ username: 'eslroot' }),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'esl-skills/eslroot_demo' })
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'eslroot', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toEqual({ token: 'gitea-token', username: 'eslroot', org: null, role: 'super' });
    expect(mockGitea.loginUser).toHaveBeenCalledWith('eslroot', 'correct-password');
  });

  it('rejects invalid CLI login credentials without issuing a token', async () => {
    const mockGitea = {
      loginUser: vi.fn().mockResolvedValue(null),
      listOrgMembers: vi.fn().mockResolvedValue([{ username: 'acme_alice' }])
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { org: 'acme', username: 'alice', password: 'wrong-password' }
    });

    expect(loginRes.statusCode).toBe(401);
    expect(loginRes.json()).toEqual({ error: 'Unauthorized: invalid credentials' });
  });

  it('requires an organization on the CLI login endpoint, structurally excluding the platform administrator', async () => {
    const mockGitea = {
      loginUser: vi.fn(),
      adminUsername: 'eslroot'
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'eslroot', password: 'whatever' }
    });

    expect(loginRes.statusCode).toBe(400);
    expect(loginRes.json().error).toContain('Organization');
    expect(mockGitea.loginUser).not.toHaveBeenCalled();
  });

  it('rejects an org-less non-admin account on the Admin Console endpoint', async () => {
    const mockGitea = {
      loginUser: vi.fn(),
      adminUsername: 'eslroot'
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/console/login',
      payload: { username: 'legacy-user', password: 'whatever' }
    });

    expect(loginRes.statusCode).toBe(403);
    expect(mockGitea.loginUser).not.toHaveBeenCalled();
  });

  it('rejects a login when the account is not a member of the organization', async () => {
    const mockGitea = {
      loginUser: vi.fn().mockResolvedValue('some-token'),
      listOrgMembers: vi.fn().mockResolvedValue([{ username: 'acme_bob' }])
    };
    app = buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { org: 'acme', username: 'alice', password: 'correct-password' }
    });

    expect(loginRes.statusCode).toBe(403);
    expect(loginRes.json().error).toContain('not a member');
    expect(mockGitea.loginUser).toHaveBeenCalledWith('acme_alice', 'correct-password');
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

  it('builds the app with a Gitea admin token', () => {
    const giteaService = new GiteaService('http://gitea:3000', 'admin-token');
    app = buildApp({
      dbPath,
      giteaService,
      repoOwner: 'esl-skills'
    });

    expect(app).toBeDefined();
  });
});
