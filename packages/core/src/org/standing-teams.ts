// 常设团队（ADR-0032）：只读 / 读写 / 技能管理三个团队随成员进出组织自动增删，
// 不可删除、不可改名；管理员团队就是 Git Backend 原生的 Owners。
// 这里是团队标识名的单一来源——服务端与前端都不再各写一份。
export const STANDING_TEAM_NAMES: readonly string[] = [
  'all-readers',
  'all-writers',
  'all-managers',
  'org-managers'
];

export function isStandingTeam(teamName: string): boolean {
  return STANDING_TEAM_NAMES.includes(teamName);
}

// 授权档位 → 常设团队标识名（share_all_* 动作的落点）
export const SHARE_TIER_TEAM_NAMES = {
  read: 'all-readers',
  write: 'all-writers',
  manage: 'all-managers'
} as const;

// 组织内身份三档（ADR-0036）：全部**由常设团队成员身份推导**，组织内不存储角色。
// 三档是嵌套的——所有者成员自动兼任管理成员，管理成员自动是组织成员。
export type OrgIdentity = 'ordinary' | 'managing' | 'owner';

// 成员加入组织时**自动**加入的三个技能授权团队。管理成员身份团队 org-managers
// 不在其中，必须由所有者成员通过身份变更授予。
export const AUTO_JOIN_TEAM_NAMES: readonly string[] = [
  'all-readers',
  'all-writers',
  'all-managers'
];

// 承载管理成员身份的专用常设团队。技能共享级别 manage 的落点仍是 all-managers。
export const MANAGING_TEAM_NAME = 'org-managers';
