import {
  isAnonymousConsumable,
  isSignedInReadable,
  normalizeSkillVisibility,
  type SkillVisibility
} from '../skill/visibility.js';

/**
 * 可安装技能发现的 core 口径源（#199 / spec #200）。
 *
 * 它是唯一一处同时知道「谁在找」「哪些技能可装」「每个技能归哪个桶」的逻辑：
 * server 负责 I/O 与授权事实（实时权限、组织集合），core 负责可见性基线与归类。
 * 匿名是 `username === null` 的特例，与登录主体走同一条判定，不另写一套过滤。
 *
 * 候选的「已发布」口径不在这里重复表达：调用方必须先用
 * `SkillRepository.searchSkills` 取候选（它已排除未发布与已归档），详见技术核查 §7。
 */

/** 发现主体：匿名是 `username === null` 的特例。 */
export interface CatalogPrincipal {
  username: string | null;
  /** 主体所属组织命名空间名集合；服务端每个请求解析一次。匿名或无组织时为空。 */
  organizationScopes: readonly string[];
}

/**
 * 命名空间归属类型：活跃租户组织 vs 个人命名空间。已冻结/删除中的组织按个人渲染
 * （与技术核查 §1.4 及管理向 `personalNamespace` 口径一致）。
 */
export type CatalogNamespaceKind = 'organization' | 'personal';

/** 技能目录三桶（spec #200：互斥、就近、每技能恰好一桶）加默认全集。 */
export type CatalogBucket = 'all' | 'platform' | 'org' | 'granted';

/** private 卡片的来源行：组织技能、他人个人技能、本人技能（「我的技能」）。 */
export interface CatalogSource {
  kind: 'organization' | 'person' | 'self';
  name: string;
}

/**
 * 服务端已取到并富化过的候选技能。越权条目在进入本层前就被排除；`accessGranted`
 * 是服务端对 private 技能的请求时刻可读判定，public/anonymous 由可见性基线判定。
 */
export interface CatalogCandidate {
  /** `@scope/name`，技能在平台内的稳定身份。 */
  identity: string;
  scope: string;
  skillName: string;
  displayName: string;
  description: string;
  visibility: SkillVisibility;
  namespaceKind: CatalogNamespaceKind;
  downloadCount: number;
  latestStableVersion?: string;
  /** 最新一次 Skill Release 快照的关键词，供 T3 关键词搜索使用。 */
  keywords?: readonly string[];
  /** private 技能的实时可读判定；public/anonymous 的可见性由 core 基线判定，此字段被忽略。 */
  accessGranted?: boolean;
}

/** 目录条目：候选加上归桶与来源标注。 */
export interface CatalogEntry extends Omit<CatalogCandidate, 'accessGranted'> {
  bucket: CatalogBucket;
  source: CatalogSource;
}

/**
 * 纯可见性基线：匿名只可消费 anonymous；登录用户可消费 public/anonymous，private
 * 另需授权事实。调用方不需要先判断登录态。
 */
export function isCatalogConsumable(
  visibility: string,
  principal: CatalogPrincipal
): boolean {
  return principal.username === null
    ? isAnonymousConsumable(visibility)
    : isSignedInReadable(visibility);
}

/**
 * 可安装判定 = 可见性基线，或（仅登录主体）private 的实时授权事实。已发布/归档
 * 由调用方的候选查询保证，不在此重复。
 */
export function isCatalogInstallable(
  candidate: CatalogCandidate,
  principal: CatalogPrincipal
): boolean {
  const visibility = normalizeSkillVisibility(candidate.visibility);
  if (visibility !== 'private') return isCatalogConsumable(visibility, principal);
  return principal.username !== null && candidate.accessGranted === true;
}

/**
 * 三桶互斥就近归类：先判命名空间，再判可见性。所在组织命名空间下的可安装技能
 * （含该组织 public）进 `org`；其余 private 进 `granted`；其余进 `platform`。
 */
export function classifyCatalogBucket(
  candidate: CatalogCandidate,
  principal: CatalogPrincipal
): CatalogBucket {
  if (
    candidate.namespaceKind === 'organization' &&
    principal.organizationScopes.includes(candidate.scope)
  ) {
    return 'org';
  }
  if (candidate.visibility === 'private') return 'granted';
  return 'platform';
}

/**
 * 来源主体：组织技能取组织名；本人个人技能为「我的技能」；他人个人技能取技能所属
 * 的个人命名空间主体（平台不记录授权执行人，见技术核查 §1.5）。
 */
export function resolveCatalogSource(
  candidate: CatalogCandidate,
  principal: CatalogPrincipal
): CatalogSource {
  if (candidate.namespaceKind === 'organization') {
    return { kind: 'organization', name: candidate.scope };
  }
  if (principal.username !== null && candidate.scope === principal.username) {
    return { kind: 'self', name: candidate.scope };
  }
  return { kind: 'person', name: candidate.scope };
}

/**
 * 发现主接缝：给定候选与主体，返回可安装全集（含桶与来源）。无权的 private
 * 候选在这里被排除，因此上层拿到的就是可下发的集合。
 */
export function discoverCatalogEntries(
  candidates: readonly CatalogCandidate[],
  principal: CatalogPrincipal
): CatalogEntry[] {
  return candidates
    .filter((candidate) => isCatalogInstallable(candidate, principal))
    .map(({ accessGranted: _accessGranted, ...candidate }) => ({
      ...candidate,
      bucket: classifyCatalogBucket(candidate, principal),
      source: resolveCatalogSource(candidate, principal)
    }));
}
