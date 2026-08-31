import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase, PlatformSettingsRepository } from '../src/db/database.js';

describe('organization application lifecycle', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-apply-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await app?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function autoModeGitea() {
    return {
      organizationExists: vi.fn().mockResolvedValue(false),
      createOrg: vi.fn().mockResolvedValue(undefined),
      createUser: vi.fn().mockResolvedValue(undefined),
      listTeams: vi
        .fn()
        .mockResolvedValue([{ id: 1, name: 'Owners', permission: 'admin' }]),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      createTeam: vi.fn().mockResolvedValue({ id: 9, name: 'team', permission: 'read' })
    };
  }

  it('initializes the Gitea organization immediately in auto mode', async () => {
    const mockGitea = autoModeGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: {
        orgName: 'acme',
        adminDisplayName: 'Acme Admin',
        password: 'initial-password'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ status: 'approved' });
    expect(mockGitea.createOrg).toHaveBeenCalledWith('acme');
    expect(mockGitea.createUser).toHaveBeenCalledWith('acme_admin', 'initial-password');
    expect(mockGitea.addTeamMember).toHaveBeenCalledWith(1, 'acme_admin');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-readers', 'read');
    expect(mockGitea.createTeam).toHaveBeenCalledWith('acme', 'all-writers', 'write');
  });

  it('stores a pending application and returns its id in manual mode', async () => {
    const settingsDb = initDatabase(dbPath);
    new PlatformSettingsRepository(settingsDb).setSetting('org_registration_mode', 'manual');
    settingsDb.close();

    const mockGitea = autoModeGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: {
        orgName: 'acme',
        adminDisplayName: 'Acme Admin',
        password: 'initial-password'
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('pending');
    expect(typeof body.applicationId).toBe('number');
    expect(mockGitea.createOrg).not.toHaveBeenCalled();
    expect(mockGitea.createUser).not.toHaveBeenCalled();
  });

  it('rejects invalid organization names before touching Gitea', async () => {
    const mockGitea = autoModeGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    for (const orgName of ['acme_corp', 'Acme', 'a', '-acme', 'acme-', 'admin', 'a'.repeat(40)]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orgs/apply',
        body: { orgName, adminDisplayName: 'Admin', password: 'initial-password' }
      });
      expect(response.statusCode).toBe(400);
    }
    expect(mockGitea.createOrg).not.toHaveBeenCalled();
  });

  it('rejects an application when the organization name is already taken', async () => {
    const mockGitea = autoModeGitea();
    mockGitea.organizationExists.mockResolvedValue(true);
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });

    expect(response.statusCode).toBe(409);
    expect(mockGitea.createOrg).not.toHaveBeenCalled();
  });

  it('rejects a duplicate application for the same organization in manual mode', async () => {
    const settingsDb = initDatabase(dbPath);
    new PlatformSettingsRepository(settingsDb).setSetting('org_registration_mode', 'manual');
    settingsDb.close();

    const mockGitea = autoModeGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const first = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });
    expect(second.statusCode).toBe(409);
  });

  it('reports initialization failure when the Gitea setup chain fails in auto mode', async () => {
    const mockGitea = autoModeGitea();
    mockGitea.createUser.mockRejectedValue(new Error('password too short'));
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme', adminDisplayName: 'Admin', password: 'initial-password' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('password too short');
  });

  it('requires orgName, admin display name, and password', async () => {
    const mockGitea = autoModeGitea();
    app = await buildApp({ dbPath, giteaService: mockGitea as any, repoOwner: 'esl-skills' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs/apply',
      body: { orgName: 'acme' }
    });

    expect(response.statusCode).toBe(400);
    expect(mockGitea.createOrg).not.toHaveBeenCalled();
  });
});
