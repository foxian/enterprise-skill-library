import {
  initDatabase,
  SkillRepository,
  SkillTeamGrantRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService, GiteaTeam } from './gitea.js';
import { DEFAULT_TEAM_DISPLAY_NAMES } from './org-team-model.js';

const STANDING_TEAM_NAMES = ['all-readers', 'all-writers', 'all-managers', 'org-managers'] as const;

/**
 * 权限数据初始化：清空技能级团队/个人授权与自定义团队，保留组织、成员账号、
 * 技能、源码和发布记录，并按当前模型重建固定组织团队。
 *
 * 该操作面向一次性的数据清理，不自动挂到服务启动路径。调用方可重复执行。
 */
export async function initializePermissionData(gitea: GiteaService, dbPath: string): Promise<void> {
  const db = initDatabase(dbPath);
  const skills = new SkillRepository(db);
  const grants = new SkillTeamGrantRepository(db);
  const tenants = new TenantOrganizationRepository(db);
  try {
    await clearSkillRepositoryPermissions(gitea, skills);
    grants.clearAll();

    for (const tenant of tenants.listAll()) {
      if (!(await gitea.organizationExists(tenant.orgName))) continue;
      await rebuildOrganizationPermissionTeams(gitea, tenant.orgName);
    }

    // 自定义团队的显示名不再有意义；固定团队按平台预置值重新播种。
    db.prepare('DELETE FROM org_team_profiles').run();
    for (const tenant of tenants.listAll()) {
      if (!(await gitea.organizationExists(tenant.orgName))) continue;
      const teams = await gitea.listTeams(tenant.orgName);
      for (const team of teams) {
        const displayName = DEFAULT_TEAM_DISPLAY_NAMES[team.name];
        if (displayName) tenants.setTeamDisplayName(tenant.orgName, team.id, displayName);
      }
    }
  } finally {
    db.close();
  }
}

async function clearSkillRepositoryPermissions(
  gitea: GiteaService,
  skills: SkillRepository
): Promise<void> {
  for (const skill of skills.listSkills()) {
    const separator = skill.gitRepoPath.indexOf('/');
    if (separator < 0) continue;
    const owner = skill.gitRepoPath.slice(0, separator);
    const repo = skill.gitRepoPath.slice(separator + 1);

    try {
      for (const team of await gitea.listRepoTeams(owner, repo)) {
        await gitea.removeTeamRepo(team.id, owner, repo);
      }
    } catch {
      // 个人仓库没有组织团队列表；它本来也不会承载团队授权。
    }

    if (typeof gitea.listCollaborators !== 'function') continue;
    for (const member of await gitea.listCollaborators(owner, repo)) {
      if (member.username !== skill.owner) {
        await gitea.removeCollaborator(owner, repo, member.username);
      }
    }
  }
}

async function rebuildOrganizationPermissionTeams(gitea: GiteaService, orgName: string): Promise<void> {
  const membersBefore = (await gitea.listOrgMembers(orgName)).map((member) => member.username);
  const teamsBefore = await gitea.listTeams(orgName);
  const managingTeamBefore = teamsBefore.find((team) => team.name === 'org-managers');
  const managingMembersBefore = managingTeamBefore
    ? (await gitea.listTeamMembers(managingTeamBefore.id)).map((member) => member.username)
    : [];
  const ownerMembers = (await gitea.listOrgOwners(orgName)).map((member) => member.username);
  const managingMembers = [...new Set([...managingMembersBefore, ...ownerMembers])];

  for (const team of teamsBefore) {
    if (team.permission !== 'owner' && !isStandingTeamName(team.name)) {
      await gitea.deleteTeam(team.id);
    }
  }

  const standingTeams: Partial<Record<(typeof STANDING_TEAM_NAMES)[number], GiteaTeam>> = {};
  for (const [name, idempotentPermission] of [
    ['all-readers', 'read'],
    ['all-writers', 'write'],
    ['all-managers', 'admin'],
    ['org-managers', 'read']
  ] as const) {
    let team = (await gitea.listTeams(orgName)).find((candidate) => candidate.name === name);
    if (!team) {
      team = await gitea.createTeam(orgName, name, idempotentPermission);
    }
    standingTeams[name] = team;
  }

  await syncTeamMembers(gitea, standingTeams['all-readers']!, membersBefore);
  await syncTeamMembers(gitea, standingTeams['all-writers']!, membersBefore);
  await syncTeamMembers(gitea, standingTeams['all-managers']!, membersBefore);
  await syncTeamMembers(gitea, standingTeams['org-managers']!, managingMembers);
}

async function syncTeamMembers(gitea: GiteaService, team: GiteaTeam, members: string[]): Promise<void> {
  const expected = new Set(members);
  const current = new Set((await gitea.listTeamMembers(team.id)).map((member) => member.username));
  for (const username of expected) {
    if (!current.has(username)) await gitea.addTeamMember(team.id, username);
  }
  for (const username of current) {
    if (!expected.has(username)) await gitea.removeTeamMember(team.id, username);
  }
}

function isStandingTeamName(name: string): boolean {
  return (STANDING_TEAM_NAMES as readonly string[]).includes(name);
}
