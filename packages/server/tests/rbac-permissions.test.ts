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
  { id: 7, name: 'frontend', permission: 'read' }
];

function createRbacGitea() {
  const mountedTeams = new Map<string, Set<number>>();
  const collaborators = new Map<string, Map<string, 'read' | 'write'>>();
  const teamMembers = new Map<number, Set<string>>([[7, new Set(['acme_bob'])]]);

  const repoCollaborators = (repo: string): Map<string, 'read' | 'write'> => {
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
      return null;
    }),
    listTeams: vi.fn(async () => orgTeams),
    listRepoTeams: vi.fn(async (_owner: string, repo: string) =>
      orgTeams.filter((team) => repoMountedTeams(repo).has(team.id))
    ),
    isTeamMember: vi.fn(async (teamId: number, username: string) => teamMembers.get(teamId)?.has(username) ?? false),
    isCollaborator: vi.fn(async (_owner: string, repo: string, username: string) =>
      repoCollaborators(repo).has(username)
    ),
    getCollaboratorPermission: vi.fn(async (_owner: string, repo: string, username: string) =>
      repoCollaborators(repo).get(username) ?? 'read'
    ),
    addTeamRepo: vi.fn(async (teamId: number, owner: string, repo: string) => {
      repoMountedTeams(repo).add(teamId);
    }),
    removeTeamRepo: vi.fn(async (teamId: number, owner: string, repo: string) => {
      repoMountedTeams(repo).delete(teamId);
    }),
    addCollaborator: vi.fn(async (_owner: string, repo: string, username: string, permission: 'read' | 'write') => {
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
});
