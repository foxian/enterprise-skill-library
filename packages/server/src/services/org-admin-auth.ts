import type { GiteaService } from './gitea.js';

// 组织管理员判定(ADR-0026):admin 账号 ∪ 系统管理团队成员。
// 登录角色、组织控制台守卫、技能访问级别三处推导点共用此判定,
// 避免各自按用户名推导造成漂移。
export async function isOrganizationAdministrator(
  giteaService: GiteaService,
  org: string,
  giteaUsername: string
): Promise<boolean> {
  if (giteaUsername === `${org}_admin`) return true;
  try {
    const teams = await giteaService.listTeams(org);
    const systemAdmins = teams.find((team) => team.name === 'system-admins');
    if (!systemAdmins) return false;
    return await giteaService.isTeamMember(systemAdmins.id, giteaUsername);
  } catch {
    // Git Backend 不可用时按非管理员降级,不阻断登录
    return false;
  }
}
