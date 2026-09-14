import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, SkillRepository, TenantOrganizationRepository } from '../src/db/database.js';
import { seedDevelopmentAccounts, seedDevelopmentData } from '../src/seed.js';
import { createGlobalGitea } from './helpers/global-gitea.js';

describe('development seed', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-seed-'));
    dbPath = path.join(tmpDir, 'seed.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds sample skill metadata idempotently', () => {
    seedDevelopmentData(dbPath);
    seedDevelopmentData(dbPath);

    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);
    const skill = repo.getSkill('@myorg/my-skill');

    expect(skill).toEqual({
      name: '@myorg/my-skill',
      scope: 'myorg',
      skillName: 'my-skill',
      description: 'Sample seeded skill',
      createdBy: 'dev',
      owner: 'platform',
      maintainers: ['dev'],
      visibility: 'public',
      gitRepoPath: 'myorg/my-skill'
    });
    expect(repo.getVersions('@myorg/my-skill')).toEqual(['0.1.0']);
    db.close();
  });

  it('seeds global development accounts idempotently (alice owns acme, bob is a member)', async () => {
    const gitea = createGlobalGitea();
    const db = initDatabase(dbPath);
    const tenantRepository = new TenantOrganizationRepository(db);
    await seedDevelopmentAccounts(gitea as any, tenantRepository);
    await seedDevelopmentAccounts(gitea as any, tenantRepository);
    db.close();

    // seed 幂等：重复启动时既存账号/组织不是错误，显式声明容忍
    expect(gitea.createUser).toHaveBeenCalledWith('alice', expect.any(String), { tolerateExisting: true });
    expect(gitea.createUser).toHaveBeenCalledWith('bob', expect.any(String), { tolerateExisting: true });
    expect(gitea.createOrg).toHaveBeenCalledWith('acme', { tolerateExisting: true });

    const owners = await (gitea.listOrgOwners as ReturnType<typeof vi.fn>)('acme');
    expect(owners.map((owner: { username: string }) => owner.username)).toContain('alice');
    // bob 是组织成员（在某个非 Owners 团队里）
    const teams = await (gitea.listTeams as ReturnType<typeof vi.fn>)('acme');
    const bobTeams = [];
    for (const team of teams) {
      if (team.permission !== 'owner' && (await gitea.isTeamMember(team.id, 'bob'))) {
        bobTeams.push(team.name);
      }
    }
    expect(bobTeams.length).toBeGreaterThan(0);

    // 开发组织同样登记进平台组织注册表（与生产路径一致：组织=active）
    const db2 = initDatabase(dbPath);
    expect(new TenantOrganizationRepository(db2).get('acme')?.status).toBe('active');
    db2.close();
  });
});
