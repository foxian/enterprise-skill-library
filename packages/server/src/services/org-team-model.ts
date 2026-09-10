// ADR-0029:默认团队的显示名由平台预置为数据。目前只有 system-admins 有 UI
// 消费点(团队管理页);三个全员团队由组织共享级别承载,团队列表与技能权限矩阵
// 均过滤它们,不播种死数据。显示名属 ESL 侧概念,不写入 Gitea。
export const DEFAULT_TEAM_DISPLAY_NAMES: Record<string, string> = {
  'system-admins': '系统管理团队'
};
