import type { FastifyInstance } from 'fastify';
import type { AdminRepository, CatalogFunnelEventRepository } from '../db/database.js';
import {
  isCatalogFunnelAction,
  isCatalogFunnelBucket,
  isCatalogTrafficSource,
  type CatalogFunnelAction,
  type CatalogFunnelBucket,
  type CatalogTrafficSource
} from '../db/database.js';
import { apiError } from '../errors.js';
import type { GiteaService } from '../services/gitea.js';
import { authenticateSkillUser } from '../services/skill-user-auth.js';

export interface CatalogEventRouteOptions {
  catalogFunnelEventRepository: CatalogFunnelEventRepository;
  adminRepository?: AdminRepository;
  giteaService: GiteaService;
}

interface CatalogEventBody {
  action?: unknown;
  skillId?: unknown;
  bucket?: unknown;
  trafficSource?: unknown;
}

/**
 * 漏斗事件上报（spec #200 / ADR-0077）：允许匿名调用，因为公开目录的流量也要入库；
 * 携带 `Authorization` 时按同一份 `authenticateSkillUser` 解析登录态，token 无效则
 * 401，绝不把无效凭据当成匿名事件。主体与 `occurred_at` 由服务端补齐，客户端传来
 * 的 `subject_user_id` / `occurred_at` 根本不读取。
 *
 * 来源标记与桶只影响报表归属，不参与任何权限判定；伪造它们最多让事件计到别的
 * 来源上。`bucket` 只在技能目录来向保留，其他来源携带一律落 NULL（宽容，不 400）。
 */
export function registerCatalogEventRoutes(
  app: FastifyInstance,
  options: CatalogEventRouteOptions
): void {
  const { catalogFunnelEventRepository, adminRepository, giteaService } = options;

  app.post('/api/catalog/events', async (request, reply) => {
    const body = (request.body ?? {}) as CatalogEventBody;

    if (!isCatalogFunnelAction(body.action)) {
      return reply.status(400).send(
        apiError('validationFailed', {
          detail: 'action must be one of catalog_view, detail_view, install_command_copy'
        })
      );
    }
    const action: CatalogFunnelAction = body.action;

    const skillId = typeof body.skillId === 'string' ? body.skillId.trim() : '';
    if (body.skillId !== undefined && typeof body.skillId !== 'string') {
      return reply
        .status(400)
        .send(apiError('validationFailed', { detail: 'skillId must be a string' }));
    }
    if (action === 'catalog_view' && skillId) {
      return reply
        .status(400)
        .send(apiError('validationFailed', { detail: 'catalog_view must not carry skillId' }));
    }
    if (action !== 'catalog_view' && !skillId) {
      return reply
        .status(400)
        .send(apiError('validationFailed', { detail: `${action} requires skillId` }));
    }

    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    // 「带了 Authorization 但解析不出主体」只能是无效凭据；无该头才是匿名。
    if (request.headers.authorization && !user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }

    const trafficSource: CatalogTrafficSource = isCatalogTrafficSource(body.trafficSource)
      ? body.trafficSource
      : 'direct_or_unknown';
    const bucket: CatalogFunnelBucket | null =
      trafficSource === 'skill_catalog' && isCatalogFunnelBucket(body.bucket) ? body.bucket : null;

    catalogFunnelEventRepository.record({
      subjectUserId: user?.id ?? null,
      subjectUsername: user?.username ?? null,
      skillId: action === 'catalog_view' ? null : skillId,
      action,
      bucket,
      trafficSource
    });

    return reply.status(202).send();
  });
}
