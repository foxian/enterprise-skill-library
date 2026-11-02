// 可见性展示的单一映射：公开目录、详情页和管理面板都从这里取标签语义，
// 避免三档判断散落在各视图里各写一遍。
export type VisibilityTagType = 'success' | 'info' | 'warning';

export function visibilityTagType(visibility: string): VisibilityTagType {
  if (visibility === 'anonymous') return 'success';
  return visibility === 'public' ? 'info' : 'warning';
}

/** 消费者目录/详情使用的 i18n key（管理面板用 skill.* 文案）。 */
export function visibilityTextKey(visibility: string): string {
  if (visibility === 'anonymous') return 'catalog.visibilityAnonymous';
  return visibility === 'public' ? 'catalog.visibilityPublic' : 'catalog.visibilityPrivate';
}
