import { quietPost } from './client';

// 技能目录漏斗埋点（#199 / spec #200，本票 #206 / ADR-0077）：只上报三层动作与
// 最小上下文——动作、技能 id、桶、来源标记。绝不带上搜索关键词、IP、User-Agent
// 或客户端环境；主体与时间由服务端从登录态与服务器时间补齐。

export type CatalogFunnelAction = 'catalog_view' | 'detail_view' | 'install_command_copy';
export type CatalogTrafficSource = 'skill_catalog' | 'public_catalog' | 'direct_or_unknown';
export type CatalogFunnelBucket = 'all' | 'platform' | 'org' | 'granted';

const TRAFFIC_SOURCES: readonly CatalogTrafficSource[] = [
  'skill_catalog',
  'public_catalog',
  'direct_or_unknown'
];

/** 缺失或未知的来源标记一律按直拼流量处理，与 ADR-0077 的落库口径一致。 */
export function normalizeTrafficSource(raw: unknown): CatalogTrafficSource {
  return typeof raw === 'string' && (TRAFFIC_SOURCES as readonly string[]).includes(raw)
    ? (raw as CatalogTrafficSource)
    : 'direct_or_unknown';
}

export interface CatalogFunnelEventInput {
  action: CatalogFunnelAction;
  /** `detail_view` / `install_command_copy` 必填；`catalog_view` 不传。 */
  skillId?: string | null;
  bucket?: CatalogFunnelBucket | null;
  trafficSource?: unknown;
}

/**
 * 上报一次漏斗动作：fire-and-forget，返回 undefined，失败静默。调用方不需要
 * await，也无法从返回值感知成败——埋点不能阻断或改变页面行为。
 */
export function reportCatalogFunnelEvent(input: CatalogFunnelEventInput): void {
  const trafficSource = normalizeTrafficSource(input.trafficSource);
  const body: Record<string, string> = { action: input.action, trafficSource };
  if (input.action !== 'catalog_view' && input.skillId) {
    body.skillId = input.skillId;
  }
  // 桶只在技能目录来向有意义；其他来源即使调用方误传也不进请求体。
  if (trafficSource === 'skill_catalog' && input.bucket) {
    body.bucket = input.bucket;
  }
  quietPost('/api/catalog/events', body);
}
