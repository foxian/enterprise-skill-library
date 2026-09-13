// ADR-0029:常设团队（ADR-0032）的显示名由平台预置为数据。团队创建时播种,
// 幂等(已存在则跳过);显示名属 ESL 侧概念,不写入 Gitea。
// 管理员团队即 Gitea 原生 Owners 团队,无需预置显示名。
export const DEFAULT_TEAM_DISPLAY_NAMES: Record<string, string> = {
  'all-readers': '组织只读团队',
  'all-writers': '组织读写团队',
  'all-managers': '组织技能管理团队'
};
