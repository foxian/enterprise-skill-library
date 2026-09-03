import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository } from '../src/db/database.js';
import { executeSkillCreation } from '../src/services/skill-operations.js';

describe('executeSkillCreation Resource Provenance', () => {
  const payload = {
    name: '@acme/demo',
    scope: 'acme',
    skillName: 'demo',
    description: 'Demo skill',
    visibility: 'public',
    username: 'acme_alice'
  };

  it('compensates the created repository when identity registration fails', async () => {
    const gitea = {
      getRepo: vi.fn().mockResolvedValue(null),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'acme/acme_demo' }),
      deleteRepo: vi.fn().mockResolvedValue(undefined)
    };
    const skillRepository = {
      getSkill: vi.fn().mockReturnValue(undefined),
      createServerSkill: vi.fn().mockImplementation(() => {
        throw new Error('registration failed');
      })
    };

    await expect(
      executeSkillCreation({ giteaService: gitea as any, skillRepository: skillRepository as any }, payload)
    ).rejects.toThrow('registration failed');

    // 身份未登记,本次操作创建的仓库被安全补偿,不留不可见孤儿资源
    expect(gitea.deleteRepo).toHaveBeenCalledWith('acme', 'acme_demo');
  });

  it('keeps the repository when identity registration succeeded', async () => {
    const gitea = {
      getRepo: vi.fn().mockResolvedValue(null),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'acme/acme_demo' }),
      deleteRepo: vi.fn().mockResolvedValue(undefined)
    };
    const skillRepository = {
      getSkill: vi.fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValue({ name: '@acme/demo', gitRepoPath: 'acme/acme_demo' }),
      createServerSkill: vi.fn().mockReturnValue({ name: '@acme/demo' })
    };

    await executeSkillCreation({ giteaService: gitea as any, skillRepository: skillRepository as any }, payload);

    expect(gitea.deleteRepo).not.toHaveBeenCalled();
    expect(skillRepository.createServerSkill).toHaveBeenCalledWith(
      expect.objectContaining({ gitRepoPath: 'acme/acme_demo', status: 'active-published' })
    );
  });

  it('adopts an existing orphan repository instead of recreating it', async () => {
    const gitea = {
      getRepo: vi.fn().mockResolvedValue({ full_name: 'acme/acme_demo' }),
      createOrganizationRepo: vi.fn(),
      deleteRepo: vi.fn()
    };
    const skillRepository = {
      getSkill: vi.fn().mockReturnValue(undefined),
      createServerSkill: vi.fn().mockReturnValue({ name: '@acme/demo' })
    };

    await executeSkillCreation({ giteaService: gitea as any, skillRepository: skillRepository as any }, payload);

    expect(gitea.createOrganizationRepo).not.toHaveBeenCalled();
    expect(skillRepository.createServerSkill).toHaveBeenCalledWith(
      expect.objectContaining({ gitRepoPath: 'acme/acme_demo' })
    );
  });

  it('is a no-op when the skill identity is already registered', async () => {
    const gitea = {
      getRepo: vi.fn(),
      createOrganizationRepo: vi.fn(),
      deleteRepo: vi.fn()
    };
    const skillRepository = {
      getSkill: vi.fn().mockReturnValue({ name: '@acme/demo' }),
      createServerSkill: vi.fn()
    };

    await executeSkillCreation({ giteaService: gitea as any, skillRepository: skillRepository as any }, payload);

    expect(gitea.createOrganizationRepo).not.toHaveBeenCalled();
    expect(skillRepository.createServerSkill).not.toHaveBeenCalled();
  });
});

describe('skill creation and permission operations', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-skill-ops-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function skillCreationGitea() {
    return {
      validateToken: vi.fn(async (token: string) =>
        token === 'alice-token' ? { id: 1, username: 'acme_alice', email: 'acme_alice@local.esl' } : null
      ),
      createOrganizationRepo: vi.fn().mockResolvedValue({ full_name: 'acme/acme_demo' }),
      getRepo: vi.fn().mockResolvedValue(null),
      deleteRepo: vi.fn().mockResolvedValue(undefined)
    };
  }

  it('records a retryable operation when skill creation fails and converges on retry', async () => {
    const mockGitea = skillCreationGitea();
    mockGitea.createOrganizationRepo
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue({ full_name: 'acme/acme_demo' });
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });

    const request = {
      method: 'POST' as const,
      url: '/api/skills',
      headers: { authorization: 'token alice-token' },
      payload: { name: '@acme/demo', description: 'Demo skill', version: '1.0.0' }
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(409);
    const operationId = first.json().operationId;
    expect(first.json().status).toBe('failed');
    expect(first.json().error).toContain('temporary failure');
    // Git Backend 中没有孤儿仓库(创建本身失败)
    expect(mockGitea.deleteRepo).not.toHaveBeenCalled();

    const db = initDatabase(dbPath);
    expect(db.prepare('SELECT status FROM operations WHERE id = ?').get(operationId)).toMatchObject({
      status: 'failed'
    });
    db.close();

    // 同一请求重试:幂等键收敛到同一 Operation 并成功
    const second = await app.inject(request);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ name: '@acme/demo', cloneUrl: expect.stringContaining('/git/acme/acme_demo') });
    expect(mockGitea.createOrganizationRepo).toHaveBeenCalledTimes(2);

    const after = initDatabase(dbPath);
    expect(after.prepare('SELECT status FROM operations WHERE id = ?').get(operationId)).toMatchObject({
      status: 'succeeded'
    });
    after.close();
  });

  it('converges duplicate publish requests for the same skill and version', async () => {
    const mockGitea = skillCreationGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });

    const request = {
      method: 'POST' as const,
      url: '/api/skills',
      headers: { authorization: 'token alice-token' },
      payload: { name: '@acme/demo', description: 'Demo skill', version: '1.0.0' }
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(201);
    // 重复发布请求:幂等收敛,不再登记重复版本
    const second = await app.inject(request);
    expect(second.statusCode).toBe(200);
    expect(second.json().versions).toEqual(['1.0.0']);
  });

  it('exposes operation status for querying by the caller', async () => {
    const mockGitea = skillCreationGitea();
    mockGitea.createOrganizationRepo.mockRejectedValueOnce(new Error('temporary failure'));
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });

    await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: 'token alice-token' },
      payload: { name: '@acme/demo', description: 'Demo skill', version: '1.0.0' }
    });

    const operation = await app.inject({
      method: 'GET',
      url: '/api/operations/1',
      headers: { authorization: 'token alice-token' }
    });
    expect(operation.statusCode).toBe(200);
    expect(operation.json()).toMatchObject({
      id: 1,
      kind: 'skill.create',
      status: 'failed',
      error: { message: 'temporary failure' }
    });

    const unauthenticated = await app.inject({ method: 'GET', url: '/api/operations/1' });
    expect(unauthenticated.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/operations/999',
      headers: { authorization: 'token alice-token' }
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('skill permission operations', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  const orgTeams = [
    { id: 1, name: 'Owners', permission: 'owner' },
    { id: 2, name: 'all-readers', permission: 'read' },
    { id: 3, name: 'all-writers', permission: 'write' },
    { id: 7, name: 'frontend', permission: 'read' }
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-skill-perm-'));
    dbPath = path.join(tmpDir, 'test.db');
    const db = initDatabase(dbPath);
    new SkillRepository(db).createServerSkill({
      name: '@acme/reviewer',
      scope: 'acme',
      skillName: 'reviewer',
      description: 'Reviewer skill',
      createdBy: 'acme_alice',
      owner: 'acme_alice',
      maintainers: ['acme_alice'],
      visibility: 'private',
      gitRepoPath: 'acme/reviewer',
      status: 'active-published'
    });
    db.close();
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function permissionGitea() {
    const mountedTeams = new Set<number>([2]);
    return {
      validateToken: vi.fn(async (token: string) =>
        token === 'alice-token' ? { id: 1, username: 'acme_alice', email: 'acme_alice@local.esl' } : null
      ),
      listTeams: vi.fn(async () => orgTeams),
      listRepoTeams: vi.fn(async () => orgTeams.filter((team) => mountedTeams.has(team.id))),
      addTeamRepo: vi.fn(async (teamId: number) => {
        mountedTeams.add(teamId);
      }),
      removeTeamRepo: vi.fn(async (teamId: number) => {
        mountedTeams.delete(teamId);
      }),
      __state: mountedTeams
    };
  }

  it('records a retryable operation when the permission change fails and converges on retry', async () => {
    const mockGitea = permissionGitea();
    mockGitea.addTeamRepo.mockRejectedValueOnce(new Error('temporary failure'));
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });

    const request = {
      method: 'POST' as const,
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token', 'idempotency-key': 'share-1' },
      payload: { action: 'add_team', team: 'frontend' }
    };

    const first = await app.inject(request);
    expect(first.statusCode).toBe(409);
    const operationId = first.json().operationId;
    expect(first.json().retryable).toBe(true);
    // Gitea 仍是事实来源:失败的变更未生效
    expect(mockGitea.__state.has(7)).toBe(false);

    const db = initDatabase(dbPath);
    expect(db.prepare('SELECT kind, status FROM operations WHERE id = ?').get(operationId)).toEqual({
      kind: 'skill.permission',
      status: 'failed'
    });
    db.close();

    // 同一幂等键重试:收敛到同一 Operation 并成功
    const second = await app.inject(request);
    expect(second.statusCode).toBe(200);
    expect(second.json().teams.map((team: { name: string }) => team.name)).toContain('frontend');
    expect(mockGitea.__state.has(7)).toBe(true);
    const after = initDatabase(dbPath);
    expect(after.prepare('SELECT status FROM operations WHERE id = ?').get(operationId)).toMatchObject({
      status: 'succeeded'
    });
    after.close();

    // 幂等键重复请求:不重复执行副作用
    const callsAfterSuccess = mockGitea.addTeamRepo.mock.calls.length;
    const third = await app.inject(request);
    expect(third.statusCode).toBe(200);
    expect(mockGitea.addTeamRepo.mock.calls.length).toBe(callsAfterSuccess);
  });

  it('executes permission changes without an idempotency key as fresh requests', async () => {
    const mockGitea = permissionGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'platform-ai' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'add_team', team: 'frontend' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().teams.map((team: { name: string }) => team.name)).toContain('frontend');
    expect(mockGitea.__state.has(7)).toBe(true);
  });
});

