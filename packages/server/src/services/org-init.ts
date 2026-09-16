import { GiteaRequestError, type GiteaService } from './gitea.js';
import type { TenantOrganizationRepository } from '../db/database.js';
import { DEFAULT_TEAM_DISPLAY_NAMES } from './org-team-model.js';
import { applyOrgIdentity, removeMemberFromOrganization } from './organization-membership.js';

// 组织同步开通（ADR-0032）：组织 = Gitea Organization，组织内身份 = 常设团队
// 成员身份（ADR-0038）。创建者（申请人或 auto 模式发起人）成为初始**所有者成员**
// ——落实为只读 / 读写 / 技能管理 / org-managers / Owners 五支团队全员到位。
// 四个常设团队在此预置；管理员团队就是 Gitea 原生 Owners，第五个无需创建。
// `<org>_admin` 专用账号与 system-admins 团队（ADR-0025/0026/0022）随多租户模型
// 一并废除。
export async function initializeOrganization(
  giteaService: GiteaService,
  orgName: string,
  creatorUsername: string,
  tenantOrganizationRepository: TenantOrganizationRepository
): Promise<void> {
  // 已存在的组织绝不能被"接管"：调用方会把创建者写进 Owners，若 Git Backend
  // 侧该组织另有其主，这就是一次提权。预检 + 严格创建共同兜住并发窗口。
  if (await giteaService.organizationExists(orgName)) {
    throw new GiteaRequestError(409, `Organization name is already taken: ${orgName}`);
  }
  await giteaService.createOrg(orgName);

  // 新建组织时 Gitea 会自动创建一个 Owners 常驻团队，其 permission 恒为 "owner"。
  const teams = await giteaService.listTeams(orgName);
  if (!teams.some((team) => team.permission === 'owner')) {
    throw new Error(`Gitea organization has no Owners team: ${orgName}`);
  }

  // 常设团队幂等预置；显示名按 ADR-0029 播种（幂等）。
  for (const [name, permission] of [
    ['all-readers', 'read'],
    ['all-writers', 'write'],
    ['all-managers', 'admin'],
    ['org-managers', 'read']
  ] as const) {
    let team = teams.find((candidate) => candidate.name === name);
    if (!team) {
      team = await giteaService.createTeam(orgName, name, permission);
    }
    const displayName = DEFAULT_TEAM_DISPLAY_NAMES[name];
    if (displayName && tenantOrganizationRepository.getTeamDisplayName(orgName, team.id) === undefined) {
      tenantOrganizationRepository.setTeamDisplayName(orgName, team.id, displayName);
    }
  }

  // 创建者成为初始所有者成员（ADR-0038）。
  await applyOrgIdentity(giteaService, orgName, creatorUsername, 'owner');

  // Gitea 用 admin token 创建组织时会把 site admin 自动加入 Owners；
  // 平台系统账号不属于任何组织（ADR-0033），必须整体移出——只摘掉 Owners 会留下
  // 一个"在成员列表里、却不属于任何团队"的残影，与"超管不参与组织"自相矛盾。
  const adminUsername = giteaService.adminUsername;
  if (adminUsername && adminUsername !== creatorUsername) {
    const isPresent = (members: { username: string }[]): boolean =>
      members.some((member) => member.username === adminUsername);
    if (isPresent(await giteaService.listOrgMembers(orgName))) {
      await removeMemberFromOrganization(giteaService, orgName, adminUsername);
    }
    if (isPresent(await giteaService.listOrgMembers(orgName))) {
      throw new Error(`Failed to detach the platform administrator from ${orgName}`);
    }
    const ownersTeam = (await giteaService.listTeams(orgName)).find(
      (team) => team.permission === 'owner'
    )!;
    if (await giteaService.isTeamMember(ownersTeam.id, adminUsername)) {
      throw new Error(`Failed to detach the platform administrator from ${orgName}`);
    }
  }
}
