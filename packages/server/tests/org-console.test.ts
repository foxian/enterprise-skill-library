import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('organization console API', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  const defaultTeams = [
    { id: 1, name: 'Owners', permission: 'admin' },
    { id: 2, name: 'all-readers', permission: 'read' },
    { id: 3, name: 'all-writers', permission: 'write' },
    { id: 7, name: 'frontend', permission: 'read' }
  ];

  function orgAdminGitea() {
    return {
      validateToken: vi.fn(async (token: string) => {
        if (token === 'acme-admin-token') return { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' };
        if (token === 'other-admin-token') return { id: 2, username: 'other_admin', email: 'other_admin@local.esl' };
        return null;
      }),
      organizationExists: vi.fn().mockResolvedValue(true),
      listOrgMembers: vi
        .fn()
        .mockResolvedValue([{ id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }]),
      createUser: vi.fn().mockResolvedValue(undefined),
      disableUser: vi.fn().mockResolvedValue(undefined),
      changeUserPassword: vi.fn().mockResolvedValue(undefined),
      listTeams: vi.fn().mockResolvedValue(defaultTeams),
      createTeam: vi.fn().mockResolvedValue({ id: 9, name: 'frontend', permission: 'read' }),
      deleteTeam: vi.fn().mockResolvedValue(undefined),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      removeTeamMember: vi.fn().mockResolvedValue(undefined),
      removeOrgMember: vi.fn().mockResolvedValue(undefined)
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-console-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects callers that are not an organization admin account', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const routes: Array<{ method: string; url: string }> = [
      { method: 'GET', url: '/api/orgs/members' },
      { method: 'POST', url: '/api/orgs/members' },
      { method: 'POST', url: '/api/orgs/members/bob/disable' },
      { method: 'POST', url: '/api/orgs/members/bob/password' },
      { method: 'GET', url: '/api/orgs/teams' },
      { method: 'POST', url: '/api/orgs/teams' },
      { method: 'DELETE', url: '/api/orgs/teams/7' },
      { method: 'POST', url: '/api/orgs/teams/7/members' },
      { method: 'DELETE', url: '/api/orgs/teams/7/members/bob' }
    ];
    for (const route of routes) {
      const response = await app.inject({
        method: route.method as any,
        url: route.url,
        headers: { authorization: 'token member-token' },
        payload: { username: 'bob', password: 'password-123', name: 'frontend', permission: 'read' }
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('rejects an administrator whose organization does not exist', async () => {
    const mockGitea = orgAdminGitea();
    mockGitea.organizationExists.mockResolvedValue(false);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(403);
  });

  it('lists the members of the administrator organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }]);
    expect(mockGitea.listOrgMembers).toHaveBeenCalledWith('acme');
  });

  it('creates a member with the assembled Gitea username and joins default teams', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob', password: 'initial-password' }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ username: 'acme_bob' });
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_bob', 'initial-password');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(2, 'acme_bob');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(3, 'acme_bob');
  });

  it('generates an initial password when adding a member without one', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob' }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.username).toBe('acme_bob');
    expect(typeof body.password).toBe('string');
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_bob', body.password);
  });

  it('disables a member by removing them from all teams and the organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members/bob/disable',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ username: 'acme_bob', disabled: true });
    expect(mockGitea.disableUser).toHaveBeenCalledWith('acme_bob');
    for (const team of defaultTeams) {
      expect(mockGitea.removeTeamMember).toHaveBeenCalledWith(team.id, 'acme_bob');
    }
    expect(mockGitea.removeOrgMember).toHaveBeenCalledWith('acme', 'acme_bob');
  });

  it('resets a member password', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/members/bob/password',
      headers: { authorization: 'token acme-admin-token' },
      payload: { password: 'reset-password' }
    });

    expect(response.statusCode).toBe(200);
    expect(mockGitea.changeUserPassword).toHaveBeenCalledWith('acme_bob', 'reset-password');
  });

  it('lists the teams of the administrator organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(defaultTeams);
  });

  it('creates a custom team with a permission level', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'backend', permission: 'write' }
    });

    expect(response.statusCode).toBe(201);
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'backend', 'write');
  });

  it('rejects an invalid permission level when creating a team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams',
      headers: { authorization: 'token acme-admin-token' },
      payload: { name: 'backend', permission: 'root' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.createTeam).not.toHaveBeenCalled();
  });

  it('refuses to delete the default teams', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    for (const teamId of [2, 3]) {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/orgs/teams/${teamId}`,
        headers: { authorization: 'token acme-admin-token' }
      });
      expect(response.statusCode).toBe(400);
    }
    expect(mockGitea.deleteTeam).not.toHaveBeenCalled();
  });

  it('deletes a custom team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/7',
      headers: { authorization: 'token acme-admin-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });
    expect(mockGitea.deleteTeam).toHaveBeenCalledWith(7);
  });

  it('refuses to operate on teams outside the administrator organization', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/999',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(del.statusCode).toBe(403);

    const join = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams/999/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob' }
    });
    expect(join.statusCode).toBe(403);
    expect(mockGitea.addTeamMember).not.toHaveBeenCalled();

    const leave = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/999/members/bob',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(leave.statusCode).toBe(403);
    expect(mockGitea.removeTeamMember).not.toHaveBeenCalled();
  });

  it('binds and unbinds members of an organization team', async () => {
    const mockGitea = orgAdminGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const join = await app.inject({
      method: 'POST',
      url: '/api/orgs/teams/7/members',
      headers: { authorization: 'token acme-admin-token' },
      payload: { username: 'bob' }
    });
    expect(join.statusCode).toBe(201);
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(7, 'acme_bob');

    const leave = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/teams/7/members/bob',
      headers: { authorization: 'token acme-admin-token' }
    });
    expect(leave.statusCode).toBe(200);
    expect(mockGitea.removeTeamMember).toHaveBeenCalledWith(7, 'acme_bob');
  });
});
