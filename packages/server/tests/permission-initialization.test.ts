import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  initDatabase,
  SkillRepository,
  SkillTeamGrantRepository,
  TenantOrganizationRepository
} from '../src/db/database.js';
import { initializePermissionData } from '../src/services/permission-initialization.js';
import { createGlobalGitea } from './helpers/global-gitea.js';

describe('permission data initialization', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('clears permission state while preserving organizations, members, skills, and releases', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-permission-init-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'test.db');
    const gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'password-123' },
        { username: 'bob', password: 'password-123' },
        { username: 'carol', password: 'password-123' }
      ],
      orgs: [{ name: 'acme', teams: [] }]
    });
    gitea.__state.setOrgOwner('acme', 'alice');
    const readers = await gitea.createTeam('acme', 'all-readers', 'read');
    const writers = await gitea.createTeam('acme', 'all-writers', 'write');
    const managers = await gitea.createTeam('acme', 'all-managers', 'admin');
    const orgManagers = await gitea.createTeam('acme', 'org-managers', 'read');
    const frontendRead = await gitea.createTeam('acme', 'frontend-read', 'read');
    const frontendWrite = await gitea.createTeam('acme', 'frontend-write', 'write');
    const frontendManage = await gitea.createTeam('acme', 'frontend-manage', 'admin');
    const legacy = await gitea.createTeam('acme', 'legacy-team', 'write');
    for (const team of [readers, writers, managers, frontendRead, frontendWrite, frontendManage, legacy]) {
      await gitea.addTeamMember(team.id, 'alice');
      await gitea.addTeamMember(team.id, 'bob');
      await gitea.addTeamMember(team.id, 'carol');
    }
    await gitea.addTeamMember(orgManagers.id, 'alice');
    await gitea.addTeamMember(orgManagers.id, 'bob');

    const db = initDatabase(dbPath);
    const skills = new SkillRepository(db);
    skills.createServerSkill({
      name: '@acme/one',
      scope: 'acme',
      skillName: 'one',
      description: 'One',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'acme/one',
      status: 'active-published'
    });
    skills.createRelease({
      skillId: skills.getSkill('@acme/one')!.skillId,
      skillName: '@acme/one',
      version: '1.0.0',
      sourceCommit: 'abc1234',
      packagePath: 'packages/one/1.0.0/skill-package.tar.gz',
      checksum: 'sha256:one',
      releaseManifest: { name: '@acme/one', version: '1.0.0' },
      dependencyLock: {},
      notes: 'keep me',
      createdBy: 'alice'
    });
    skills.createServerSkill({
      name: '@alice/personal',
      scope: 'alice',
      skillName: 'personal',
      description: 'Personal',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'alice/personal',
      status: 'active-published'
    });
    new SkillTeamGrantRepository(db).set('@acme/one', frontendRead.id, 'write');
    const tenants = new TenantOrganizationRepository(db);
    tenants.create({ orgName: 'acme', status: 'active' });
    tenants.setTeamDisplayName('acme', frontendRead.id, '前端团队');
    db.close();

    for (const team of [readers, writers, managers, frontendRead, frontendWrite, frontendManage, legacy]) {
      await gitea.addTeamRepo(team.id, 'acme', 'one');
    }
    await gitea.addCollaborator('acme', 'one', 'alice', 'admin');
    await gitea.addCollaborator('acme', 'one', 'bob', 'write');

    await initializePermissionData(gitea as never, dbPath);
    await initializePermissionData(gitea as never, dbPath);

    const teamNames = (await gitea.listTeams('acme')).map((team) => team.name).sort();
    expect(teamNames).toEqual(['Owners', 'all-managers', 'all-readers', 'all-writers', 'org-managers']);
    expect(await gitea.listRepoTeams('acme', 'one')).toEqual([]);
    expect((await gitea.listCollaborators('acme', 'one')).map((member) => member.username)).toEqual(['alice']);
    for (const name of ['all-readers', 'all-writers', 'all-managers']) {
      const team = (await gitea.listTeams('acme')).find((candidate) => candidate.name === name)!;
      expect((await gitea.listTeamMembers(team.id)).map((member) => member.username).sort()).toEqual([
        'alice',
        'bob',
        'carol'
      ]);
    }
    const orgManagersAfter = (await gitea.listTeams('acme')).find((team) => team.name === 'org-managers')!;
    expect((await gitea.listTeamMembers(orgManagersAfter.id)).map((member) => member.username).sort()).toEqual([
      'alice',
      'bob'
    ]);

    const reopened = initDatabase(dbPath);
    expect(new SkillRepository(reopened).getSkill('@acme/one')).toMatchObject({
      name: '@acme/one',
      gitRepoPath: 'acme/one'
    });
    expect(new SkillRepository(reopened).getReleases('@acme/one')).toHaveLength(1);
    expect(new SkillTeamGrantRepository(reopened).list('@acme/one')).toEqual([]);
    expect(new TenantOrganizationRepository(reopened).getTeamDisplayName('acme', frontendRead.id)).toBeUndefined();
    expect(new TenantOrganizationRepository(reopened).getTeamDisplayName('acme', readers.id)).toBe(
      '组织只读团队'
    );
    reopened.close();
  });
});
