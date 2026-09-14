import { AUTO_JOIN_TEAM_NAMES, MANAGING_TEAM_NAME, type OrgIdentity } from '@esl/core';
import type { GiteaOrg, GiteaService } from './gitea.js';

/**
 * 组织隶属关系（ADR-0036）。`identity` 是组织内三档身份，全部**由常设团队成员
 * 身份推导**——普通成员 = 只读/读写团队成员，管理成员 = 技能管理团队成员，
 * 所有者成员 = 组织管理团队（Gitea Owners）的成员。组织内不存储角色——它是逐
 * 组织的团队身份，不是平台角色。
 */
export interface OrganizationMembership {
  org: string;
  identity: OrgIdentity;
  /** 便捷判据：是否所有者成员。治理入口与路由守卫以此为准。 */
  isOwnerMember: boolean;
}

export interface OrgMemberWithIdentity {
  username: string;
  identity: OrgIdentity;
}

/**
 * 该用户在某组织是否是**所有者成员**（组织管理团队 = Gitea Owners 的成员）。
 * 组织不存在或查询失败一律按"不是"处理（fail closed）；这是组织治理权的唯一
 * 判据，登录、"我的组织"与各治理路由必须共用它，不得各处自行推导。
 */
export async function isOwnerMemberOf(
  giteaService: GiteaService,
  org: string,
  username: string
): Promise<boolean> {
  return (await listOwnerMemberNames(giteaService, org)).has(username);
}

/**
 * 该用户是否持有**管理成员**身份（技能管理团队成员）。与治理权判定同样 fail
 * closed：查询失败按"不是"处理——它跑在登录路径上，不能因为一次读失败就让
 * 整个登录塌掉，而"少一档身份"是安全的降级方向。
 */
export async function isManagingMemberOf(
  giteaService: GiteaService,
  org: string,
  username: string
): Promise<boolean> {
  try {
    const team = (await giteaService.listTeams(org)).find((entry) => entry.name === MANAGING_TEAM_NAME);
    if (!team) return false;
    return await giteaService.isTeamMember(team.id, username);
  } catch {
    return false;
  }
}

/**
 * 从"在不在 Owners / 在不在技能管理团队"推出身份。三档嵌套：所有者成员自动兼任
 * 管理成员（ADR-0036），因此判定顺序必须是 owner → managing → ordinary。
 */
export function identityFromTeamMembership(isOwner: boolean, isManaging: boolean): OrgIdentity {
  if (isOwner) return 'owner';
  return isManaging ? 'managing' : 'ordinary';
}

/**
 * 派生该用户的全部组织隶属关系与逐组织身份。登录响应与个人控制台的「我的组织」
 * 共用同一份派生，避免两处各算一遍。
 *
 * 代价说明：逐组织要读一次团队表（找技能管理团队的 id）再做一次成员判定。这是
 * 登录与「我的组织」这种低频路径，可以接受；**不要**把它搬进逐请求的权限判定。
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
    const isOwner = await isOwnerMemberOf(giteaService, org.name, username);
    const isManaging = isOwner || (await isManagingMemberOf(giteaService, org.name, username));
    const identity = identityFromTeamMembership(isOwner, isManaging);
    memberships.push({ org: org.name, identity, isOwnerMember: identity === 'owner' });
  }
  return memberships;
}

/**
 * 该组织管理团队（Owners）的全部成员名。走 `listOrgOwners` 这条窄接缝——它是
 * Git Backend 直接给出的"组织所有者"读法，也是权限判定热路径上既有的依赖面；
 * 不要改成 listTeams + listTeamMembers 绕一圈，那会让每次技能访问判定多两次调用。
 * 查询失败按空集合处理（fail closed）。
 */
export async function listOwnerMemberNames(giteaService: GiteaService, org: string): Promise<Set<string>> {
  try {
    return new Set((await giteaService.listOrgOwners(org)).map((owner) => owner.username));
  } catch {
    return new Set();
  }
}

/**
 * 成员列表附带三档身份。治理界面据此标注身份，并决定每个身份变更动作是否可用。
 */
export async function listOrgMembersWithIdentity(
  giteaService: GiteaService,
  org: string
): Promise<OrgMemberWithIdentity[]> {
  const members = await giteaService.listOrgMembers(org);
  const ownerNames = await listOwnerMemberNames(giteaService, org);
  const managingTeam = (await giteaService.listTeams(org)).find(
    (team) => team.name === MANAGING_TEAM_NAME
  );
  const managingNames = managingTeam
    ? new Set((await giteaService.listTeamMembers(managingTeam.id)).map((member) => member.username))
    : new Set<string>();
  return members.map((member) => ({
    username: member.username,
    identity: identityFromTeamMembership(
      ownerNames.has(member.username),
      managingNames.has(member.username)
    )
  }));
}

/**
 * 加入组织时的自动入队：只读、读写两个常设团队。**技能管理团队不在其中**——
 * 它承载管理成员身份，必须显式授予（ADR-0036）；组织管理团队（Owners）同理。
 */
export async function addMemberToAutoJoinTeams(
  giteaService: GiteaService,
  org: string,
  username: string
): Promise<void> {
  for (const team of await giteaService.listTeams(org)) {
    if (AUTO_JOIN_TEAM_NAMES.includes(team.name) && !(await giteaService.isTeamMember(team.id, username))) {
      await giteaService.addTeamMember(team.id, username);
    }
  }
}

/**
 * 把某人置为指定身份（ADR-0036）。三档嵌套，因此落实方式是"补齐下级、摘掉上级"：
 * 三档都保证在只读/读写，管理成员与所有者成员在技能管理团队，仅所有者成员在
 * Owners。调用方负责先做不变量校验。
 */
export async function applyOrgIdentity(
  giteaService: GiteaService,
  org: string,
  username: string,
  identity: OrgIdentity
): Promise<void> {
  await addMemberToAutoJoinTeams(giteaService, org, username);
  const teams = await giteaService.listTeams(org);
  const managing = teams.find((team) => team.name === MANAGING_TEAM_NAME);
  const owners = teams.find((team) => team.permission === 'owner');

  const shouldManage = identity === 'managing' || identity === 'owner';
  if (managing) {
    await syncTeamMember(giteaService, managing.id, username, shouldManage);
  }
  if (owners) {
    await syncTeamMember(giteaService, owners.id, username, identity === 'owner');
  }
}

async function syncTeamMember(
  giteaService: GiteaService,
  teamId: number,
  username: string,
  shouldBeMember: boolean
): Promise<void> {
  const isMember = await giteaService.isTeamMember(teamId, username);
  if (shouldBeMember && !isMember) {
    await giteaService.addTeamMember(teamId, username);
  } else if (!shouldBeMember && isMember) {
    await giteaService.removeTeamMember(teamId, username);
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
 * 所有者成员不变量（ADR-0036）：**任何走法都不能让组织失去全部所有者成员**——
 * 被他人移除、自我降级、自我退出，三者是同一条规则。`nextIdentity` 为 null 表示
 * 离开组织。
 *
 * 注意这条规则里**没有调用者**：早期版本禁止"移除自己"，现在自我降级与自我退出
 * 都是正当动作（"我不想再管了"不该需要求别人动手），唯一的约束来自"要走的人
 * 是不是最后一名所有者成员"。返回 null 表示放行，否则返回可行动的错误说明。
 */
export async function checkOwnerMemberInvariant(
  giteaService: GiteaService,
  org: string,
  target: string,
  nextIdentity: OrgIdentity | null
): Promise<string | null> {
  const ownerNames = await listOwnerMemberNames(giteaService, org);
  if (!ownerNames.has(target) || ownerNames.size > 1) {
    return null;
  }
  return nextIdentity === null
    ? 'The last owner member cannot leave or be removed from the organization'
    : 'The organization must keep at least one owner member';
}
