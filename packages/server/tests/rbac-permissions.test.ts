import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, SkillRepository } from '../src/db/database.js';

const orgTeams = [
  { id: 1, name: 'Owners', permission: 'owner' },
  { id: 2, name: 'all-readers', permission: 'read' },
  { id: 3, name: 'all-writers', permission: 'write' },
  { id: 7, name: 'frontend', permission: 'read' },
  { id: 8, name: 'admins', permission: 'admin' }
];

function createRbacGitea() {
  const mountedTeams = new Map<string, Set<number>>();
  const collaborators = new Map<string, Map<string, 'read' | 'write' | 'admin'>>();
  const teamMembers = new Map<number, Set<string>>([[7, new Set(['acme_bob'])]]);

  const repoCollaborators = (repo: string): Map<string, 'read' | 'write' | 'admin'> => {
    let perRepo = collaborators.get(repo);
    if (!perRepo) {
      perRepo = new Map();
      collaborators.set(repo, perRepo);
    }
    return perRepo;
  };
  const repoMountedTeams = (repo: string): Set<number> => {
    let mounted = mountedTeams.get(repo);
    if (!mounted) {
      mounted = new Set();
      mountedTeams.set(repo, mounted);
    }
    return mounted;
  };

  repoCollaborators('reviewer').set('acme_alice', 'write');
  repoCollaborators('secret').set('acme_zed', 'write');

  return {
    validateToken: vi.fn(async (token: string) => {
      if (token === 'alice-token') return { id: 1, username: 'acme_alice', email: 'acme_alice@local.esl' };
      if (token === 'admin-token') return { id: 2, username: 'acme_admin', email: 'acme_admin@local.esl' };
      if (token === 'bob-token') return { id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' };
      if (token === 'super-token') return { id: 9, username: 'eslroot', email: 'eslroot@local.esl' };
      return null;
    }),
    adminUsername: 'eslroot',
    listTeams: vi.fn(async () => orgTeams),
    listRepoTeams: vi.fn(async (_owner: string, repo: string) =>
      orgTeams.filter((team) => repoMountedTeams(repo).has(team.id))
    ),
    isTeamMember: vi.fn(async (teamId: number, username: string) => teamMembers.get(teamId)?.has(username) ?? false),
    isCollaborator: vi.fn(async (_owner: string, repo: string, username: string) =>
      repoCollaborators(repo).has(username)
    ),
    getCollaboratorPermission: vi.fn(async (_owner: string, repo: string, username: string) =>
      repoCollaborators(repo).get(username) ?? 'none'
    ),
    addTeamRepo: vi.fn(async (teamId: number, owner: string, repo: string) => {
      repoMountedTeams(repo).add(teamId);
    }),
    removeTeamRepo: vi.fn(async (teamId: number, owner: string, repo: string) => {
      repoMountedTeams(repo).delete(teamId);
    }),
    addCollaborator: vi.fn(async (_owner: string, repo: string, username: string, permission: 'read' | 'write' | 'admin') => {
      repoCollaborators(repo).set(username, permission);
    }),
    removeCollaborator: vi.fn(async (_owner: string, repo: string, username: string) => {
      repoCollaborators(repo).delete(username);
    }),
    listCollaborators: vi.fn(async (_owner: string, repo: string) =>
      Array.from(repoCollaborators(repo).entries()).map(([username, permission]) => ({ username, permission }))
    ),
    __state: { repoMountedTeams, repoCollaborators, teamMembers }
  };
}

describe('skill RBAC permissions', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-rbac-'));
    dbPath = path.join(tmpDir, 'test.db');
    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    repository.createServerSkill({
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
    repository.createServerSkill({
      name: '@acme/secret',
      scope: 'acme',
      skillName: 'secret',
      description: 'Private skill',
      createdBy: 'acme_zed',
      owner: 'acme_zed',
      maintainers: ['acme_zed'],
      visibility: 'private',
      gitRepoPath: 'acme/secret',
      status: 'active-published'
    });
    db.close();
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the private permission matrix to the owner', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      scope: 'acme',
      skillName: 'reviewer',
      sharedAllRead: false,
      sharedAllWrite: false,
      sharedAllManage: false,
      teams: [],
      members: [{ username: 'acme_alice', permission: 'write' }]
    });
  });

  it('reports the all-managers share level and filters default teams from the grant list', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.listTeams.mockResolvedValue([
      ...orgTeams,
      { id: 4, name: 'all-managers', permission: 'admin' },
      { id: 5, name: 'system-admins', permission: 'admin' }
    ]);
    // all-managers 与 system-admins 都挂载到仓库:前者构成共享级别,
    // 后者是结构性全库授权,两者都不应出现在团队授权列表
    mockGitea.listRepoTeams.mockImplementation(async (_owner: string, repo: string) => [
      { id: 4, name: 'all-managers', permission: 'admin' },
      { id: 5, name: 'system-admins', permission: 'admin' },
      ...orgTeams.filter((team) => mockGitea.__state.repoMountedTeams(repo).has(team.id))
    ]);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      scope: 'acme',
      skillName: 'reviewer',
      sharedAllRead: false,
      sharedAllWrite: false,
      sharedAllManage: true,
      teams: [],
      members: [{ username: 'acme_alice', permission: 'write' }]
    });
  });

  it('shares to all readers and all writers through the team repo API', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token alice-token' };

    const read = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers,
      payload: { action: 'share_all_read' }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().sharedAllRead).toBe(true);
    expect(mockGitea.addTeamRepo).toHaveBeenCalledWith(2, 'acme', 'reviewer');

    const write = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers,
      payload: { action: 'share_all_write' }
    });
    expect(write.json().sharedAllWrite).toBe(true);
    expect(mockGitea.addTeamRepo).toHaveBeenCalledWith(3, 'acme', 'reviewer');
  });

  it('share_all_manage mounts the all-managers team and drops lower share levels', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.listTeams.mockResolvedValue([
      ...orgTeams,
      { id: 4, name: 'all-managers', permission: 'admin' },
      { id: 5, name: 'system-admins', permission: 'admin' }
    ]);
    // 先处于全员只读档
    await mockGitea.addTeamRepo(2, 'acme', 'reviewer');
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'share_all_manage' }
    });

    expect(response.statusCode).toBe(200);
    expect(mockGitea.addTeamRepo).toHaveBeenCalledWith(4, 'acme', 'reviewer');
    // 组织共享级别互斥:设置更高级别自动卸载低级别全员团队挂载(ADR-0026)
    expect(mockGitea.removeTeamRepo).toHaveBeenCalledWith(2, 'acme', 'reviewer');
  });

  it('share_all_write drops the all-readers mount when moving up a level', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.listTeams.mockResolvedValue([
      ...orgTeams,
      { id: 4, name: 'all-managers', permission: 'admin' }
    ]);
    await mockGitea.addTeamRepo(2, 'acme', 'reviewer');
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'share_all_write' }
    });

    expect(response.statusCode).toBe(200);
    expect(mockGitea.addTeamRepo).toHaveBeenCalledWith(3, 'acme', 'reviewer');
    expect(mockGitea.removeTeamRepo).toHaveBeenCalledWith(2, 'acme', 'reviewer');
  });

  it('grants and revokes a custom team through the team repo API', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token alice-token' };

    const granted = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers,
      payload: { action: 'add_team', team: 'frontend' }
    });
    expect(granted.statusCode).toBe(200);
    expect(mockGitea.addTeamRepo).toHaveBeenCalledWith(7, 'acme', 'reviewer');
    expect(granted.json().teams).toEqual([{ id: 7, name: 'frontend', permission: 'read' }]);

    const revoked = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers,
      payload: { action: 'remove_team', team: 'frontend' }
    });
    expect(revoked.json().teams).toEqual([]);
    expect(mockGitea.removeTeamRepo).toHaveBeenCalledWith(7, 'acme', 'reviewer');
  });

  it('rejects an unknown team when granting team access', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'add_team', team: 'ghost' }
    });

    expect(response.statusCode).toBe(404);
  });

  it('grants and revokes individual members through the collaborator API', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token alice-token' };

    const granted = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers,
      payload: { action: 'add_member', username: 'acme_bob', permission: 'write' }
    });
    expect(granted.statusCode).toBe(200);
    expect(mockGitea.addCollaborator).toHaveBeenCalledWith('acme', 'reviewer', 'acme_bob', 'write');
    expect(granted.json().members).toContainEqual({ username: 'acme_bob', permission: 'write' });

    const revoked = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers,
      payload: { action: 'remove_member', username: 'acme_bob' }
    });
    expect(mockGitea.removeCollaborator).toHaveBeenCalledWith('acme', 'reviewer', 'acme_bob');
    expect(revoked.json().members).not.toContainEqual({ username: 'acme_bob', permission: 'write' });
  });

  it('resets the skill to private while keeping the owner access', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.__state.repoMountedTeams('reviewer').add(2);
    mockGitea.__state.repoMountedTeams('reviewer').add(7);
    mockGitea.__state.repoCollaborators('reviewer').set('acme_bob', 'read');
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'reset_to_private' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sharedAllRead: false, teams: [] });
    expect(mockGitea.removeTeamRepo).toHaveBeenCalledWith(2, 'acme', 'reviewer');
    expect(mockGitea.removeTeamRepo).toHaveBeenCalledWith(7, 'acme', 'reviewer');
    expect(mockGitea.removeCollaborator).toHaveBeenCalledWith('acme', 'reviewer', 'acme_bob');
    expect(mockGitea.removeCollaborator).not.toHaveBeenCalledWith('acme', 'reviewer', 'acme_alice');
    expect(mockGitea.__state.repoCollaborators('reviewer').has('acme_alice')).toBe(true);
  });

  it('allows the organization administrator to manage permissions', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token admin-token' },
      payload: { action: 'share_all_read' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().sharedAllRead).toBe(true);
  });

  it('rejects permission changes from a member without ownership', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token bob-token' },
      payload: { action: 'share_all_read' }
    });

    expect(response.statusCode).toBe(403);
    expect(mockGitea.addTeamRepo).not.toHaveBeenCalled();
  });

  it('rejects an unknown permission action', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'make_public' }
    });

    expect(response.statusCode).toBe(400);
  });

  it('filters search results to skills the caller can read', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const aliceSearch = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=',
      headers: { authorization: 'token alice-token' }
    });
    expect(aliceSearch.json().map((skill: { skillName: string }) => skill.skillName)).toEqual(['reviewer']);

    const bobSearch = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=',
      headers: { authorization: 'token bob-token' }
    });
    expect(bobSearch.json()).toEqual([]);

    const anonymousSearch = await app.inject({ method: 'GET', url: '/api/skills/search?q=' });
    expect(anonymousSearch.json()).toEqual([]);
  });

  it('grants team members read access to a mounted skill', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.__state.repoMountedTeams('reviewer').add(7);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const search = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=',
      headers: { authorization: 'token bob-token' }
    });
    expect(search.json().map((skill: { skillName: string }) => skill.skillName)).toEqual(['reviewer']);

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/reviewer',
      headers: { authorization: 'token bob-token' }
    });
    expect(info.statusCode).toBe(200);
  });

  it('blocks skill info and package downloads without read access', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    const reviewer = repository.getSkill('@acme/reviewer');
    const secret = repository.getSkill('@acme/secret');
    assert.ok(reviewer);
    assert.ok(secret);
    db.close();

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/secret',
      headers: { authorization: 'token alice-token' }
    });
    expect(info.statusCode).toBe(403);

    const anonymousInfo = await app.inject({ method: 'GET', url: '/api/skills/@acme/secret' });
    expect(anonymousInfo.statusCode).toBe(403);

    const missingSkill = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/nonexistent',
      headers: { authorization: 'token alice-token' }
    });
    expect(missingSkill.statusCode).toBe(404);

    const deniedPackage = await app.inject({
      method: 'GET',
      url: `/api/packages/${secret.skillId}/1.0.0/somechecksum`,
      headers: { authorization: 'token alice-token' }
    });
    expect(deniedPackage.statusCode).toBe(403);

    const allowedPackage = await app.inject({
      method: 'GET',
      url: `/api/packages/${reviewer.skillId}/1.0.0/somechecksum`,
      headers: { authorization: 'token alice-token' }
    });
    expect(allowedPackage.statusCode).toBe(404);
  });

  it('grants manage permission to a member and reports it as manage', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const granted = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'add_member', username: 'acme_bob', permission: 'manage' }
    });
    expect(granted.statusCode).toBe(200);
    // ESL 的 manage 档映射为 Gitea admin 级协作者(ADR-0025)
    expect(mockGitea.addCollaborator).toHaveBeenCalledWith('acme', 'reviewer', 'acme_bob', 'admin');
    expect(granted.json().members).toContainEqual({ username: 'acme_bob', permission: 'manage' });
  });

  it('lets a manage-level collaborator configure permissions and publish', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.__state.repoCollaborators('secret').set('acme_bob', 'admin');
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });
    const headers = { authorization: 'token bob-token' };

    const shared = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/secret/permissions',
      headers,
      payload: { action: 'share_all_read' }
    });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().sharedAllRead).toBe(true);

    const released = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/secret/releases',
      headers,
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });
    expect(released.statusCode).toBe(201);
  });

  it('lets a manage-level team member configure permissions', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.__state.repoMountedTeams('secret').add(8);
    mockGitea.__state.teamMembers.set(8, new Set(['acme_bob']));
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/secret/permissions',
      headers: { authorization: 'token bob-token' },
      payload: { action: 'share_all_read' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().sharedAllRead).toBe(true);
  });

  it('still rejects publishing from a write-level collaborator', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/secret/releases',
      // acme_zed 是 secret 的 owner,但请求方 bob 只有 write 协作者权限
      headers: { authorization: 'token bob-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns the member inventory split into managed and shared (incl. unpublished)', async () => {
    const mockGitea = createRbacGitea();
    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    // 未发布技能:仅创建者 alice 可见,应出现在 alice 的清单中
    repository.createServerSkill({
      name: '@acme/draft',
      scope: 'acme',
      skillName: 'draft',
      description: 'Draft skill',
      createdBy: 'acme_alice',
      owner: 'acme_alice',
      maintainers: ['acme_alice'],
      visibility: 'private',
      gitRepoPath: 'acme/draft',
      status: 'active-unreleased'
    });
    db.close();
    // bob:经 read 团队共享 reviewer,经 admin 协作者代管 secret
    mockGitea.__state.repoMountedTeams('reviewer').add(7);
    mockGitea.__state.repoCollaborators('secret').set('acme_bob', 'admin');
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const bobInventory = await app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token bob-token' }
    });
    expect(bobInventory.statusCode).toBe(200);
    const bobRows = bobInventory.json();
    expect(bobRows).toHaveLength(2);
    expect(bobRows.map((row: { name: string; access: string; relation: string }) => [row.name, row.access, row.relation]))
      .toEqual(expect.arrayContaining([
        ['@acme/secret', 'manage', 'managed'],
        ['@acme/reviewer', 'read', 'shared']
      ]));

    const aliceInventory = await app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token alice-token' }
    });
    const aliceRows = aliceInventory.json();
    // alice 是 reviewer/draft 的创建者(managed),对 secret 无任何授权,不可见
    expect(aliceRows).toHaveLength(2);
    expect(aliceRows.map((row: { name: string; access: string; relation: string }) => [row.name, row.access, row.relation]))
      .toEqual(expect.arrayContaining([
        ['@acme/reviewer', 'manage', 'managed'],
        ['@acme/draft', 'manage', 'managed']
      ]));
  });

  it('returns the full organization inventory to the organization administrator', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const inventory = await app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token admin-token' }
    });
    const rows = inventory.json();
    expect(rows).toHaveLength(2);
    expect(rows.every((row: { relation: string }) => row.relation === 'managed')).toBe(true);
    expect(rows.map((row: { name: string }) => row.name)).toEqual(expect.arrayContaining(['@acme/reviewer', '@acme/secret']));
  });

  it('returns the cross-organization inventory to the super administrator', async () => {
    const mockGitea = createRbacGitea();
    const db = initDatabase(dbPath);
    const repository = new SkillRepository(db);
    // 另一组织的技能:成员与组织管理员均不可见,超管跨组织可见
    repository.createServerSkill({
      name: '@beta/internal',
      scope: 'beta',
      skillName: 'internal',
      description: 'Beta internal skill',
      createdBy: 'beta_zoe',
      owner: 'beta_zoe',
      maintainers: ['beta_zoe'],
      visibility: 'private',
      gitRepoPath: 'beta/internal',
      status: 'active-unreleased'
    });
    db.close();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const superInventory = await app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token super-token' }
    });
    const superRows = superInventory.json();
    expect(superRows).toHaveLength(3);
    expect(superRows.map((row: { name: string }) => row.name)).toEqual(
      expect.arrayContaining(['@acme/reviewer', '@acme/secret', '@beta/internal'])
    );
    expect(superRows.every((row: { relation: string }) => row.relation === 'managed')).toBe(true);

    const memberInventory = await app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token bob-token' }
    });
    expect(memberInventory.json().map((row: { name: string }) => row.name)).not.toContain('@beta/internal');
  });

  // SC-G3 (ADR-0025 词汇边界):授权档位只用 ESL 三档,拒绝 Gitea 原词
  it('rejects the Gitea vocabulary admin when granting a member', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'add_member', username: 'acme_bob', permission: 'admin' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.addCollaborator).not.toHaveBeenCalled();
  });

  // SC-G4 (ADR-0025 行为变化):组织管理员现在也可以 publish
  it('lets the organization administrator publish', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/secret/releases',
      headers: { authorization: 'token admin-token' },
      payload: {
        version: '1.0.0',
        sourceCommit: 'abc123',
        releaseManifest: {
          schemaVersion: 1,
          license: 'MIT',
          keywords: [],
          compatibility: {},
          dependencies: {}
        }
      }
    });

    expect(response.statusCode).toBe(201);
  });

  // SC-G5a/G5b (ADR-0025 守门统一):archive 由管理权守门
  it('lets a manage-level collaborator archive the skill', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.__state.repoCollaborators('secret').set('acme_bob', 'admin');
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/secret/archive',
      headers: { authorization: 'token bob-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('archived');
  });

  it('still rejects archiving from a write-level collaborator', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.__state.repoCollaborators('reviewer').set('acme_bob', 'write');
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/archive',
      headers: { authorization: 'token bob-token' }
    });

    expect(response.statusCode).toBe(403);
  });

  // SC-G6a/G6b (ADR-0025 超管治理可见性):超管可读私有技能
  it('lets the super administrator read a private skill', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const info = await app.inject({
      method: 'GET',
      url: '/api/skills/@acme/secret',
      headers: { authorization: 'token super-token' }
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().name).toBe('@acme/secret');

    const search = await app.inject({
      method: 'GET',
      url: '/api/skills/search?q=',
      headers: { authorization: 'token super-token' }
    });
    expect(search.json().map((skill: { skillName: string }) => skill.skillName)).toEqual(
      expect.arrayContaining(['reviewer', 'secret'])
    );
  });

  // ADR-0026 系统管理团队:成员持全部技能仓库的结构性 admin 授权,
  // 对未共享给自己的私有技能同样持有管理权。
  it('lets a system management team member manage any skill in the organization', async () => {
    const mockGitea = createRbacGitea();
    const systemAdmins = { id: 5, name: 'system-admins', permission: 'admin' as const };
    const teamsWithSystemAdmins = [...orgTeams, systemAdmins];
    mockGitea.listTeams.mockResolvedValue(teamsWithSystemAdmins);
    // system-admins 是全部仓库团队,Gitea 对任何仓库的团队列表都包含它
    mockGitea.listRepoTeams.mockImplementation(async (_owner: string, repo: string) => [
      systemAdmins,
      ...orgTeams.filter((team) => mockGitea.__state.repoMountedTeams(repo).has(team.id))
    ]);
    mockGitea.isTeamMember.mockImplementation(
      async (teamId: number, username: string) =>
        (teamId === systemAdmins.id ? username === 'acme_bob' : false) ||
        (mockGitea.__state.teamMembers.get(teamId)?.has(username) ?? false)
    );
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const matrix = await app.inject({
      method: 'GET',
      url: '/api/skills/acme/secret/permissions',
      headers: { authorization: 'token bob-token' }
    });
    expect(matrix.statusCode).toBe(200);

    const inventory = await app.inject({
      method: 'GET',
      url: '/api/skills/inventory',
      headers: { authorization: 'token bob-token' }
    });
    const relations = Object.fromEntries(
      inventory.json().map((skill: { skillName: string; relation: string }) => [skill.skillName, skill.relation])
    );
    expect(relations).toEqual({ reviewer: 'managed', secret: 'managed' });
  });

  // SC-G7:inventory 要求登录,匿名返回 401(与 search 的静默空数组不同)
  it('rejects anonymous inventory access with 401', async () => {
    const mockGitea = createRbacGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({ method: 'GET', url: '/api/skills/inventory' });

    expect(response.statusCode).toBe(401);
  });

  // SC-G10 (ADR-0025):撤销 manage 授权后立即失去配权限能力
  it('loses manage capability after the grant is revoked', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.__state.repoCollaborators('reviewer').set('acme_bob', 'admin');
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const before = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token bob-token' },
      payload: { action: 'share_all_read' }
    });
    expect(before.statusCode).toBe(200);

    const revoked = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token alice-token' },
      payload: { action: 'remove_member', username: 'acme_bob' }
    });
    expect(revoked.statusCode).toBe(200);
    expect(mockGitea.removeCollaborator).toHaveBeenCalledWith('acme', 'reviewer', 'acme_bob');

    const after = await app.inject({
      method: 'POST',
      url: '/api/skills/acme/reviewer/permissions',
      headers: { authorization: 'token bob-token' },
      payload: { action: 'share_all_read' }
    });
    expect(after.statusCode).toBe(403);
  });

  // SC-G11 (ADR-0025):矩阵把 Gitea admin 级团队呈现为 manage
  it('reports an admin-level team as manage in the permission matrix', async () => {
    const mockGitea = createRbacGitea();
    mockGitea.__state.repoMountedTeams('secret').add(8);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    // 组织管理员对本组织技能持有管理权,可读任意技能矩阵
    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/acme/secret/permissions',
      headers: { authorization: 'token admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().teams).toContainEqual({ id: 8, name: 'admins', permission: 'manage' });
  });
});
