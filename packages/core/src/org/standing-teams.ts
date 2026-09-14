// 常设团队（ADR-0032）：只读 / 读写 / 技能管理三个团队随成员进出组织自动增删，
// 不可删除、不可改名；管理员团队就是 Git Backend 原生的 Owners。
// 这里是团队标识名的单一来源——服务端与前端都不再各写一份。
export const STANDING_TEAM_NAMES: readonly string[] = ['all-readers', 'all-writers', 'all-managers'];

export function isStandingTeam(teamName: string): boolean {
  return STANDING_TEAM_NAMES.includes(teamName);
}

// 授权档位 → 常设团队标识名（share_all_* 动作的落点）
export const SHARE_TIER_TEAM_NAMES = {
  read: 'all-readers',
  write: 'all-writers',
  manage: 'all-managers'
} as const;
