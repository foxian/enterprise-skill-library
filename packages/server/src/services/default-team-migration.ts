import type { TenantOrganizationRepository } from '../db/database.js';
import type { GiteaService } from './gitea.js';

// ADR-0026 存量迁移:把四档默认团队补建到既有 active 组织(四档模型启用前创建
// 的组织只有 all-readers / all-writers)。幂等——团队已存在则跳过,只补建缺失
// 的两个新团队并确保 admin 账号加入 system-admins。迁移失败不阻断启动
// (Gitea 临时不可用可等下次重启重试),但每个组织各自独立,互不影响。
export async function ensureDefaultTeamsForActiveOrgs(
  giteaService: GiteaService,
  tenantOrganizationRepository: TenantOrganizationRepository
): Promise<void> {
  const activeOrgs = tenantOrganizationRepository
    .listAll()
    .filter((org) => org.status === 'active');
  for (const org of activeOrgs) {
    try {
      const orgName = org.orgName;
      const teams = await giteaService.listTeams(orgName);
      if (!teams.some((team) => team.name === 'all-managers')) {
        await giteaService.createTeam(orgName, 'all-managers', 'admin');
      }
      let systemAdmins = teams.find((team) => team.name === 'system-admins');
      if (!systemAdmins) {
        systemAdmins = await giteaService.createTeam(orgName, 'system-admins', 'admin', {
          includesAllRepositories: true,
          canCreateOrgRepo: true
        });
      }
      const members = await giteaService.listTeamMembers(systemAdmins.id);
      const adminUsername = `${orgName}_admin`;
      if (!members.some((member) => member.username === adminUsername)) {
        await giteaService.addTeamMember(systemAdmins.id, adminUsername);
      }
      await cleanupRedundantGrants(giteaService, orgName, systemAdmins.id, adminUsername);
    } catch {
      // 单个组织的迁移失败不拖垮整个平台启动,遗留到下次重启重试
    }
  }
}

const ALL_SHARE_TEAM_NAMES = new Set(['all-readers', 'all-writers', 'all-managers']);

function shareLevel(name: string): number {
  return name === 'all-managers' ? 2 : name === 'all-writers' ? 1 : name === 'all-readers' ? 0 : -1;
}

// 清理四档模型引入前的存量无意义授权(ADR-0026):
// 1. 撤销对 admin 账号与系统管理团队成员的个人协作授权——两者结构性持有
//    全部技能的 Manage,协作授权冗余且会造成"可撤销"错觉;
// 2. 重复的全员团队挂载归一为最高档,保持组织共享级别单一档位语义。
// 依赖权限 API 的环节用 typeof 守卫,兼容无权限 API 的 Git Backend。
async function cleanupRedundantGrants(
  giteaService: GiteaService,
  orgName: string,
  systemAdminsTeamId: number,
  adminUsername: string
): Promise<void> {
  if (typeof giteaService.listOrgRepos !== 'function') return;
  const systemAdminsMembers = await giteaService.listTeamMembers(systemAdminsTeamId);
  const redundant = new Set(systemAdminsMembers.map((member) => member.username));
  redundant.add(adminUsername);

  for (const repo of await giteaService.listOrgRepos(orgName)) {
    const repoName = repo.name;
    if (
      typeof giteaService.listCollaborators === 'function' &&
      typeof giteaService.removeCollaborator === 'function'
    ) {
      for (const member of await giteaService.listCollaborators(orgName, repoName)) {
        if (redundant.has(member.username)) {
          await giteaService.removeCollaborator(orgName, repoName, member.username);
        }
      }
    }
    if (
      typeof giteaService.listRepoTeams === 'function' &&
      typeof giteaService.removeTeamRepo === 'function'
    ) {
      const mounted = await giteaService.listRepoTeams(orgName, repoName);
      const mountedAllTeams = mounted.filter((team) => ALL_SHARE_TEAM_NAMES.has(team.name));
      const highest = Math.max(...mountedAllTeams.map((team) => shareLevel(team.name)), -1);
      for (const team of mountedAllTeams) {
        if (shareLevel(team.name) < highest) {
          await giteaService.removeTeamRepo(team.id, orgName, repoName);
        }
      }
    }
  }
}
