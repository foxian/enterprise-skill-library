import {
  discoverCatalogEntries,
  filterCatalogEntries,
  highestStableVersion,
  isSignedInReadable,
  normalizeSkillVisibility,
  type CatalogBucket,
  type CatalogCandidate,
  type CatalogEntry,
  type CatalogPrincipal
} from '@esl/core';
import type {
  DownloadLogRepository,
  SkillRecord,
  SkillRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import { logEvent, type DiagnosticLogger } from '../logging.js';
import type { GiteaService } from './gitea.js';
import { getAccessLevel } from './skill-access.js';

/**
 * 可安装技能发现的服务层（#199 / spec #200，本票 #202）。
 *
 * 职责边界：本层负责 I/O 与授权事实（组织集合、请求时刻读权限、Release 富化、
 * 下载量），可见性基线与归桶/来源交给 `@esl/core` 的 `discoverCatalogEntries`。
 * 公开目录 `/api/skills/search` 与登录技能目录 `/api/catalog/skills` 共用本层，
 * 匿名是 `username === null` 的特例，不产生第二套过滤逻辑。
 */

export interface SkillCatalogDependencies {
  repository: SkillRepository;
  giteaService: GiteaService;
  tenantOrganizationRepository: TenantOrganizationRepository;
  downloadLogRepository?: DownloadLogRepository;
}

export interface CatalogDiscoveryOptions {
  /** 命名空间硬过滤（公开目录 `/api/skills/search` 的 `namespace` 参数）。 */
  namespace?: string;
  /**
   * 浏览桶（技术核查 §1.3）：`all` 为默认全集，其余取三桶之一。归桶是纯函数，
   * 越权条目已在候选阶段被排除，因此桶筛选不会放宽权限。
   */
  bucket?: CatalogBucket;
  /**
   * 关键词（技术核查 §4.5：名称/描述/显示名/最新 Release keywords）。
   * 与桶 AND 叠加；空串表示不过滤。
   */
  query?: string;
  /**
   * 归桶与来源需要主体的组织集合。目录端点开启；不消费桶的调用方（公共搜索）
   * 跳过这次 Git Backend 查询，避免给高频搜索加一次远端调用。
   */
  resolveOrganizationScopes?: boolean;
  /**
   * 与 `/api/skills/*` 的组织激活门禁对齐：排除非活跃（冻结/删除中）组织命名空间
   * 的技能。技能目录端点开启；公共搜索保持既有行为不变（本票不改公开目录口径）。
   */
  excludeInactiveOrganizations?: boolean;
}

/** 服务层返回条目：在 core 目录条目上补一个只供内部聚合用的 Skill ID。 */
export interface DiscoveredSkill extends CatalogEntry {
  skillId?: string;
}

export class SkillCatalogService {
  constructor(private readonly dependencies: SkillCatalogDependencies) {}

  /**
   * 当前主体可安装的已发布技能全集。候选来自 `searchSkills`（已排除未发布与
   * 已归档）；越权 private 在这里被排除，因此返回值可直接下发。
   */
  async discover(
    principal: { username: string | null },
    options: CatalogDiscoveryOptions = {},
    logger?: DiagnosticLogger
  ): Promise<DiscoveredSkill[]> {
    const { repository, tenantOrganizationRepository, downloadLogRepository } = this.dependencies;
    const organizationScopes = await this.organizationScopesOf(
      principal.username,
      options.resolveOrganizationScopes === true,
      logger
    );

    const candidates: CatalogCandidate[] = [];
    const skillIds = new Map<string, string | undefined>();
    for (const skill of repository.searchSkills('', { namespace: options.namespace })) {
      const tenant = tenantOrganizationRepository.get(skill.scope);
      if (options.excludeInactiveOrganizations && tenant && tenant.status !== 'active') continue;
      // 未发布（无任何 Skill Release）的技能不可安装，不进入发现面。
      const releases = repository.getReleases(skill.name);
      if (releases.length === 0) continue;
      const accessGranted = await this.accessGrantedOf(skill, principal.username, logger);
      if (accessGranted === null) continue;
      // getReleases 按 id 倒序 = 发布时间最新（含 prerelease，ADR-0048）；
      // 显示名与 keywords 同源取这份快照。
      const latestRelease = releases[0];
      candidates.push({
        identity: skill.name,
        scope: skill.scope,
        skillName: skill.skillName,
        displayName: catalogDisplayName(latestRelease.releaseManifest, skill.skillName),
        description: skill.description,
        visibility: normalizeSkillVisibility(skill.visibility),
        // 已冻结/删除中的组织不是活跃租户，按个人命名空间渲染归属（技术核查 §1.4）。
        namespaceKind: tenant?.status === 'active' ? 'organization' : 'personal',
        downloadCount: 0,
        latestStableVersion: highestStableVersion(releases.map((release) => release.version)),
        keywords: releaseKeywords(latestRelease.releaseManifest),
        accessGranted
      });
      skillIds.set(skill.name, skill.skillId);
    }

    const catalogPrincipal: CatalogPrincipal = { username: principal.username, organizationScopes };
    // 先归桶/关键词（纯内存、只作用于已确认可读的条目），再批量取下载量。
    const entries = filterCatalogEntries(discoverCatalogEntries(candidates, catalogPrincipal), {
      bucket: options.bucket,
      query: options.query
    });
    // 下载量（跨版本汇总）是公开信号（ADR-0067）：批量取，不逐条查。
    const counts = downloadLogRepository?.getSkillDownloadCounts(
      [...skillIds.values()].filter((skillId): skillId is string => Boolean(skillId))
    );
    return entries.map((entry) => {
      const skillId = skillIds.get(entry.identity);
      return {
        ...entry,
        skillId,
        downloadCount: (skillId && counts?.get(skillId)) || 0
      };
    });
  }

  /**
   * private 技能的请求时刻可读判定。public/anonymous 是登录基线，直接短路不查权限；
   * 权限查询异常按 fail closed 排除该条并记诊断，不让整个目录 500。
   * 返回 `null` 表示该条应被排除。
   */
  private async accessGrantedOf(
    skill: SkillRecord,
    username: string | null,
    logger?: DiagnosticLogger
  ): Promise<boolean | null> {
    if (username === null || isSignedInReadable(skill.visibility)) return false;
    try {
      return (await getAccessLevel(this.dependencies.giteaService, skill, username)) !== 'none';
    } catch (error) {
      logEvent(
        logger,
        'warn',
        {
          event: 'skill.catalog.access-check-failed',
          outcome: 'failed',
          actorUsername: username,
          resourceType: 'skill',
          resourceId: skill.name,
          err: error
        },
        'Skill catalog access check failed; entry excluded'
      );
      return null;
    }
  }

  /** 登录主体一次请求只解析一次组织集合（不逐组织查团队，见技术核查 §1.6）。 */
  private async organizationScopesOf(
    username: string | null,
    enabled: boolean,
    logger?: DiagnosticLogger
  ): Promise<string[]> {
    if (!enabled || username === null) return [];
    try {
      return (await this.dependencies.giteaService.listUserOrgs(username)).map((org) => org.name);
    } catch (error) {
      // 组织集合解析失败只影响归桶（org 桶退化为空），不阻断目录，也不放宽权限。
      logEvent(
        logger,
        'warn',
        {
          event: 'skill.catalog.organizations-unavailable',
          outcome: 'failed',
          actorUsername: username,
          dependency: 'git-backend',
          err: error
        },
        'Failed to list organizations for skill catalog; bucket classification degraded'
      );
      return [];
    }
  }
}

// 目录显示名（ADR-0048）：有发布时取最近 Release 快照的 displayName，
// 缺失或为空回退 Identity 短名。运行时不做 Title Case，保持用户原文。
export function catalogDisplayName(releaseManifest: unknown, fallback: string): string {
  const displayName = (releaseManifest as { displayName?: unknown }).displayName;
  return typeof displayName === 'string' && displayName.trim() ? displayName : fallback;
}

// 关键词解析（#142）：与显示名同一数据源——最近一次 Skill Release（按发布时间，
// 含预发布）快照的 keywords。保留清单中的原始文本；非字符串、空白与重复项丢弃。
export function releaseKeywords(manifest: unknown): string[] {
  const raw = (manifest as { keywords?: unknown }).keywords;
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))
  ];
}
