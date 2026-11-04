import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from 'vue-router';
import { validateOrgName } from '@esl/core/dist/org/org-name.js';

export type SkillListTab = 'managed' | 'shared';

/**
 * 技能深层页（manage / external）与列表页之间的导航编解码。
 *
 * 技能管理有三个入口：全局技能列表、组织详情技能页签、概览页快捷入口。
 * 历史栈不可预测（`router.back()` 可能回到概览页），所以由入口把"从哪来"
 * 与列表状态编码进 query，深层页据 query 渲染面包屑并回到语义父级。
 */
export function buildManageEntryQuery(
  route: RouteLocationNormalizedLoaded,
  state: { tab?: SkillListTab; page?: number } = {}
): Record<string, string> {
  const query: Record<string, string> = {};
  if (route.name === 'me-org-skills') {
    query.from = 'org-skills';
    query.org = String(route.params.org ?? '');
  } else {
    query.from = 'skills';
    const namespace = String(route.query.namespace ?? '');
    if (namespace) query.namespace = namespace;
  }
  if (state.tab === 'shared') query.tab = 'shared';
  if (state.page && state.page > 1) query.page = String(state.page);
  return query;
}

function listStateQuery(route: RouteLocationNormalizedLoaded): Record<string, string> {
  const query: Record<string, string> = {};
  if (route.query.tab === 'shared') query.tab = 'shared';
  const page = Number.parseInt(String(route.query.page ?? ''), 10);
  if (Number.isFinite(page) && page > 1) query.page = String(page);
  return query;
}

/** 深层页 -> 语义父级列表。超管恒回技能总览；个人侧按入口 query 还原组织上下文。 */
export function resolveSkillListLocation(
  route: RouteLocationNormalizedLoaded,
  isSuper: boolean
): RouteLocationRaw {
  if (isSuper) return { name: 'super-skills' };

  const query = listStateQuery(route);
  const org = route.query.org;
  if (
    route.query.from === 'org-skills' &&
    typeof org === 'string' &&
    validateOrgName(org).success
  ) {
    return { name: 'me-org-skills', params: { org }, query };
  }
  const namespace = route.query.namespace;
  if (typeof namespace === 'string' && namespace) query.namespace = namespace;
  return { name: 'me-skills', query };
}

/** external <-> manage 互链：原样透传来源 query，使面包屑链不断。 */
export function passthroughEntryQuery(route: RouteLocationNormalizedLoaded): Record<string, string> {
  return Object.fromEntries(
    Object.entries(route.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

/** 合法且来自组织技能页签的组织名；否则空串（书签畸形参数降级为全局链）。 */
export function orgScopeFromQuery(route: RouteLocationNormalizedLoaded): string {
  const org = route.query.org;
  if (route.query.from !== 'org-skills' || typeof org !== 'string') return '';
  return validateOrgName(org).success ? org : '';
}
