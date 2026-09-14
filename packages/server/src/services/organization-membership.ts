import { isStandingTeam } from '@esl/core';
import type { GiteaOrg, GiteaService } from './gitea.js';

/**
 * 组织隶属关系（ADR-0033）。`isOrgManager` 是该用户在某组织的治理权判据：
 * 组织管理团队（= Gitea Owners）的成员身份。它是逐组织的团队身份，不是平台
 * 角色——平台角色只有 Super Administrator 与 Skill User 两个。
 */
export interface OrganizationMembership {
  org: string;
  isOrgManager: boolean;
}

export interface OrgMemberWithGovernance {
  username: string;
  isOrgManager: boolean;
}

/**
 * 该用户在某组织是否是组织管理团队成员。组织不存在或查询失败一律按"无治理权"
 * 处理（fail closed）；这是组织治理权的唯一判据，登录、"我的组织"与各治理路由
 * 必须共用它，不得各处自行推导。
 */
export async function isOrgManagerOf(
  giteaService: GiteaService,
  org: string,
  username: string
): Promise<boolean> {
  return (await listOrgManagerNames(giteaService, org)).has(username);
}

/**
 * 派生该用户的全部组织隶属关系与逐组织治理权。登录响应与个人控制台的
 * 「我的组织」共用同一份派生，避免两处各算一遍。
 */
export async function deriveOrganizations(
  giteaService: GiteaService,
  username: string
): Promise<OrganizationMembership[]> {
  let orgs: GiteaOrg[];
  try {
    orgs = await giteaService.listUserOrgs(username);
  } catch {
    return [];
  }
  const memberships: OrganizationMembership[] = [];
  for (const org of orgs) {
    memberships.push({
      org: org.name,
      isOrgManager: await isOrgManagerOf(giteaService, org.name, username)
    });
  }
  return memberships;
}

/**
 * 该组织管理团队（Owners）的全部成员名。走 `listOrgOwners` 这条窄接缝——它是
 * Git Backend 直接给出的"组织所有者"读法，也是权限判定热路径上既有的依赖面；
 * 不要改成 listTeams + listTeamMembers 绕一圈，那会让每次技能访问判定多两次调用。
 * 查询失败按空集合处理（fail closed）。
 */
export async function listOrgManagerNames(giteaService: GiteaService, org: string): Promise<Set<string>> {
  try {
    return new Set((await giteaService.listOrgOwners(org)).map((owner) => owner.username));
  } catch {
    return new Set();
  }
}

/**
 * 成员列表附带治理身份。组织治理界面据此标注身份，并决定「移出」是否可用
 * （不能移除自己、组织管理团队至少保留一名成员）。
 */
export async function listOrgMembersWithGovernance(
  giteaService: GiteaService,
  org: string
): Promise<OrgMemberWithGovernance[]> {
  const members = await giteaService.listOrgMembers(org);
  const managerNames = await listOrgManagerNames(giteaService, org);
  return members.map((member) => ({
    username: member.username,
    isOrgManager: managerNames.has(member.username)
  }));
}

/**
 * 加入组织时的自动入队：三个常设团队（只读 / 读写 / 技能管理）全员同步，
 * 组织管理团队（Owners）不在此列——治理权要显式授予（ADR-0032）。
 */
export async function addMemberToStandingTeams(
  giteaService: GiteaService,
  org: string,
  username: string
): Promise<void> {
  for (const team of await giteaService.listTeams(org)) {
    if (isStandingTeam(team.name) && !(await giteaService.isTeamMember(team.id, username))) {
      await giteaService.addTeamMember(team.id, username);
    }
  }
}

/** 离开组织的自动清退：先从全部团队（含 Owners）移出，再退出组织。 */
export async function removeMemberFromOrganization(
  giteaService: GiteaService,
  org: string,
  username: string
): Promise<void> {
  for (const team of await giteaService.listTeams(org)) {
    if (await giteaService.isTeamMember(team.id, username)) {
      await giteaService.removeTeamMember(team.id, username);
    }
  }
  await giteaService.removeOrgMember(org, username);
}

/**
 * 组织管理团队成员互管规则（ADR-0033）：成员之间可以互相移除——不能移除自己，
 * 且组织管理团队必须至少保留一名成员，组织不能变成无主资产。目标不是管理团队
 * 成员时不受约束。`caller` 为 null 表示平台管理员（不参与组织，故无"自己"可言）。
 * 返回 null 表示放行，否则返回可行动的错误说明。
 */
export async function checkOrgManagerRemoval(
  giteaService: GiteaService,
  org: string,
  target: string,
  caller: string | null
): Promise<string | null> {
  const managerNames = await listOrgManagerNames(giteaService, org);
  if (!managerNames.has(target)) return null;
  if (caller !== null && target === caller) {
    return 'You cannot remove yourself from the organization management team';
  }
  if (managerNames.size <= 1) {
    return 'The organization management team must keep at least one member';
  }
  return null;
}
