import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { initDatabase } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';

// npm 式组织创建（ADR-0032 / #54）：auto 即时开通、manual 申请审批（同步开通）、
// 四个常设团队预置；部署模式 / 默认组织 / <org>_admin / system-admins 全部拆除。
describe('organization creation', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: FastifyInstance;
  let gitea: GlobalGiteaFake;
  let superToken: string;

  async function switchMode(mode: 'auto' | 'manual'): Promise<void> {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/orgs/settings',
      headers: { authorization: `token ${superToken}` },
      payload: { orgRegistrationMode: mode }
    });
    expect(res.statusCode).toBe(200);
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-org-create-'));
    dbPath = path.join(tmpDir, 'test.db');
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'eslroot', password: 'root-password' }
      ],
      orgs: []
    });
    superToken = (await gitea.loginUser('eslroot', 'root-password'))!;
    const db = initDatabase(dbPath);
    db.close();
    app = await buildApp({ dbPath, giteaService: gitea as any, repoOwner: 'esl-skills' });
    gitea.validateToken.mockImplementation(async (token: string) =>
      token === 'alice-token' ? { id: 1, username: 'alice', email: 'alice@local.esl' } : null
    );
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function ownerMembers(orgName: string): Promise<string[]> {
    const teams = await gitea.listTeams(orgName);
    const owners = teams.find((team) => team.permission === 'owner')!;
    return (await gitea.listTeamMembers(owners.id)).map((member) => member.username);
  }

  it('auto mode creates the organization instantly with the creator as Organization Admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ orgName: 'beta', status: 'active', role: 'org-admin' });
    expect(gitea.createOrg).toHaveBeenCalledWith('beta');
    expect(await ownerMembers('beta')).toContain('alice');
  });

  it('presets the four standing teams with display names on creation', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });

    const teams = await gitea.listTeams('beta');
    const names = teams.map((team) => team.name).sort();
    expect(names).toEqual(['all-managers', 'all-readers', 'all-writers', 'Owners'].sort());
    // Owners 是管理员团队（第四常设团队），其余三档权限固定
    const byName = new Map(teams.map((team) => [team.name, team.permission]));
    expect(byName.get('Owners')).toBe('owner');
    expect(byName.get('all-readers')).toBe('read');
    expect(byName.get('all-writers')).toBe('write');
    expect(byName.get('all-managers')).toBe('admin');
  });

  it('rejects creation with a reserved or taken name at submission time', async () => {
    await gitea.createOrg('taken');
    for (const [name, status] of [
      ['system', 400],
      ['taken', 409],
      ['alice', 409]
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/orgs',
        headers: { authorization: 'token alice-token' },
        payload: { orgName: name }
      });
      expect(res.statusCode).toBe(status);
    }
  });

  it('manual mode queues an application; approval provisions synchronously with the applicant as admin', async () => {
    await switchMode('manual');

    const apply = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    expect(apply.statusCode).toBe(201);
    expect(apply.json()).toMatchObject({ status: 'pending' });
    expect(gitea.createOrg).not.toHaveBeenCalled();

    const approve = await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/approve',
      headers: { authorization: `token ${superToken}` }
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json()).toMatchObject({ status: 'active', orgName: 'beta', applicant: 'alice' });
    expect(gitea.createOrg).toHaveBeenCalledWith('beta');
    expect(await ownerMembers('beta')).toContain('alice');
    const teams = await gitea.listTeams('beta');
    expect(teams.map((team) => team.name).sort()).toEqual(
      ['all-managers', 'all-readers', 'all-writers', 'Owners'].sort()
    );
  });

  it('rejecting an application releases the name for new applications', async () => {
    await switchMode('manual');
    await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/orgs/applications/1/reject',
      headers: { authorization: `token ${superToken}` }
    });

    const reapply = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    expect(reapply.statusCode).toBe(201);
    expect(gitea.createOrg).not.toHaveBeenCalled();
  });

  it('deduplicates a pending application with the same name at submission time', async () => {
    await switchMode('manual');
    await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/orgs/applications',
      headers: { authorization: 'token alice-token' },
      payload: { orgName: 'beta' }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toContain('pending');
  });
});
