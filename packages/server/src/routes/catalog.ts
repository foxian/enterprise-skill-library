import { isCatalogBucket, type CatalogBucket } from '@esl/core';
import { apiError } from '../errors.js';
import type { FastifyInstance } from 'fastify';
import type { AdminRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import type { DiscoveredSkill, SkillCatalogService } from '../services/skill-catalog.js';
import { authenticateSkillUser } from '../services/skill-user-auth.js';

export interface CatalogRouteOptions {
  catalogService: SkillCatalogService;
  adminRepository?: AdminRepository;
  giteaService: GiteaService;
}

// 目录条目（T3 契约）：身份、显示名、描述、最新稳定版、可见性、下载量、归属信息，
// 外加互斥桶与来源主体。本人技能的「我的技能」文案由 Web 按 `source.kind === 'self'`
// 映射；后端只给枚举与主体名。
function toCatalogView(entry: DiscoveredSkill) {
  return {
    identity: entry.identity,
    scope: entry.scope,
    skillName: entry.skillName,
    displayName: entry.displayName,
    description: entry.description,
    latestStableVersion: entry.latestStableVersion,
    visibility: entry.visibility,
    downloadCount: entry.downloadCount,
    namespaceKind: entry.namespaceKind,
    // ESL 没有独立的组织/用户显示名字段，主体名就是命名空间名（技术核查 §1.4）。
    namespaceName: entry.scope,
    bucket: entry.bucket,
    source: entry.source
  };
}

/** 目录端点默认单次加载条数，与公开目录 `/api/skills/search` 一致（技术核查 §4.3）。 */
const DEFAULT_CATALOG_LIMIT = 50;

/**
 * 登录主体可安装技能目录（spec #200，本票 #203）：必须登录，返回当前主体此刻有权
 * 安装消费的全部已发布技能，可按互斥桶与关键词筛选。匿名是公开目录的主体为空特例，
 * 不是本端点的入参。与 `/api/skills/search` 共用 `SkillCatalogService`，越权条目在
 * 服务端即被排除，关键词只作用在已确认可读的集合上。
 */
export function registerCatalogRoutes(app: FastifyInstance, options: CatalogRouteOptions): void {
  const { catalogService, adminRepository, giteaService } = options;

  app.get('/api/catalog/skills', async (request, reply) => {
    const { bucket: bucketParam, q, limit } = request.query as {
      bucket?: string;
      q?: string;
      limit?: string;
    };
    if (bucketParam !== undefined && !isCatalogBucket(bucketParam)) {
      return reply.status(400).send(
        apiError('validationFailed', {
          detail: 'bucket must be one of all, platform, org, granted'
        })
      );
    }
    // 与 /api/skills/search 同口径：任意正整数，非法值 400。
    let limitCount = DEFAULT_CATALOG_LIMIT;
    if (limit !== undefined) {
      const parsed = Number(limit);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return reply
          .status(400)
          .send(apiError('validationFailed', { detail: 'limit must be a positive integer' }));
      }
      limitCount = parsed;
    }
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    const bucket: CatalogBucket = bucketParam ?? 'all';
    const entries = await catalogService.discover(
      { username: user.username },
      {
        bucket,
        query: q ?? '',
        // 归桶/来源需要组织集合；一次请求只解析一次。
        resolveOrganizationScopes: true,
        // 与 /api/skills/* 的组织激活门禁对齐：冻结/删除中的组织技能不进目录。
        excludeInactiveOrganizations: true
      },
      request.log
    );
    // V1 沿用公开目录形态：单次 limit、无 offset，桶与关键词过滤在先。
    return entries.slice(0, limitCount).map(toCatalogView);
  });
}
