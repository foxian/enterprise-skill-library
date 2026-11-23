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

// 目录条目（T2 契约）：身份、显示名、描述、最新稳定版、可见性、下载量，外加归属
// 类型与主体名。private 的来源行（组织名 / 授权方 / 「我的技能」）由 T3 在 core
// 的 `resolveCatalogSource` 之上补进响应；本票不暴露桶，也不接 bucket / q。
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
    namespaceName: entry.scope
  };
}

/**
 * 登录主体可安装技能目录（spec #200，本票 #202）：必须登录，返回当前主体此刻有权
 * 安装消费的全部已发布技能。匿名是公开目录的主体为空特例，不是本端点的入参。
 * 与 `/api/skills/search` 共用 `SkillCatalogService`，越权条目在服务端即被排除。
 */
export function registerCatalogRoutes(app: FastifyInstance, options: CatalogRouteOptions): void {
  const { catalogService, adminRepository, giteaService } = options;

  app.get('/api/catalog/skills', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    const entries = await catalogService.discover(
      { username: user.username },
      {
        // 目录响应当前不暴露桶，但归桶/来源是 T3 的既定消费方；组织集合一次取好。
        resolveOrganizationScopes: true,
        // 与 /api/skills/* 的组织激活门禁对齐：冻结/删除中的组织技能不进目录。
        excludeInactiveOrganizations: true
      },
      request.log
    );
    return entries.map(toCatalogView);
  });
}
