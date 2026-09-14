import { GiteaRequestError, type GiteaService } from './gitea.js';
import type { TenantOrganizationRepository } from '../db/database.js';
import { DEFAULT_TEAM_DISPLAY_NAMES } from './org-team-model.js';

// 组织同步开通（ADR-0032）：组织 = Gitea Organization，管理员 = Owners 团队成员。
// 创建者（申请人或 auto 模式发起人）加入 Owners 即成为初始 Organization Admin。
// 组织创建时预置三个常设团队（只读 / 读写 / 技能管理）——管理员团队就是 Gitea
// 原生 Owners，第四个常设团队无需创建。`<org>_admin` 专用账号与 system-admins
// 团队（ADR-0025/0026/0022）随多租户模型一并废除。
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
  const ownersTeam = teams.find((team) => team.permission === 'owner');
  if (!ownersTeam) {
    throw new Error(`Gitea organization has no Owners team: ${orgName}`);
  }
  const ownersMembers = await giteaService.listTeamMembers(ownersTeam.id);
  if (!ownersMembers.some((member) => member.username === creatorUsername)) {
    await giteaService.addTeamMember(ownersTeam.id, creatorUsername);
  }

  // Gitea 用 admin token 创建组织时会把 site admin 自动加入 Owners；
  // 平台系统账号不属于组织治理面，移出以保持 Owners 只含组织管理员。
  if (giteaService.adminUsername && giteaService.adminUsername !== creatorUsername &&
      typeof giteaService.removeTeamMember === 'function') {
    if (ownersMembers.some((member) => member.username === giteaService.adminUsername)) {
      await giteaService.removeTeamMember(ownersTeam.id, giteaService.adminUsername);
    }
  }

  // 常设团队幂等预置；创建者作为组织成员一并进入三个常设团队（与后续拉人同一
  // 不变量：成员 ∈ 只读 ∪ 读写 ∪ 技能管理）。显示名按 ADR-0029 播种（幂等）。
  for (const [name, permission] of [
    ['all-readers', 'read'],
    ['all-writers', 'write'],
    ['all-managers', 'admin']
  ] as const) {
    let team = teams.find((candidate) => candidate.name === name);
    if (!team) {
      team = await giteaService.createTeam(orgName, name, permission);
    }
    const displayName = DEFAULT_TEAM_DISPLAY_NAMES[name];
    if (displayName && tenantOrganizationRepository.getTeamDisplayName(orgName, team.id) === undefined) {
      tenantOrganizationRepository.setTeamDisplayName(orgName, team.id, displayName);
    }
    const members = await giteaService.listTeamMembers(team.id);
    if (!members.some((member) => member.username === creatorUsername)) {
      await giteaService.addTeamMember(team.id, creatorUsername);
    }
  }
}
