import { RESERVED_SCOPE_NAMES, validateOrgName } from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  OrgApplicationRepository,
  PlatformSettingsRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { initializeOrganization } from '../services/org-init.js';

export interface OrgRouteOptions {
  giteaService: GiteaService;
  orgApplicationRepository: OrgApplicationRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
}

// 组织创建（ADR-0032）：任何已注册用户可创建多个组织，方式由平台设置
// org_registration_mode 决定——auto 同步即时创建；manual 提交申请、超管批准后
// 同步开通。申请提交时即按扁平命名池查重，冲突不会到达审批环节。
export function registerOrgRoutes(app: FastifyInstance, options: OrgRouteOptions): void {
  const { giteaService, orgApplicationRepository, platformSettingsRepository, tenantOrganizationRepository } = options;

  async function requireSkillUser(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('token ')) {
      reply.status(401).send({ error: 'Unauthorized: missing token' });
      return null;
    }
    const user = await giteaService.validateToken(authorization.replace('token ', '').trim());
    if (!user) {
      reply.status(401).send({ error: 'Unauthorized: invalid token' });
      return null;
    }
    return user.username;
  }

  // 扁平命名池查重（先到先得）：已存在组织 / 用户 / 保留名 / 同名待审申请。
  async function rejectIfNameTaken(orgName: string, reply: FastifyReply): Promise<boolean> {
    if (await giteaService.organizationExists(orgName)) {
      reply.status(409).send({ error: 'Organization name is already taken' });
      return true;
    }
    if (await giteaService.getUser(orgName)) {
      reply.status(409).send({ error: 'Organization name collides with an existing user' });
      return true;
    }
    if (orgApplicationRepository.getApplication(orgName)?.status === 'pending') {
      reply.status(409).send({ error: 'An application for this organization name is already pending' });
      return true;
    }
    return false;
  }

  app.post('/api/orgs', async (request, reply) => {
    const username = await requireSkillUser(request, reply);
    if (!username) return;

    const { orgName = '' } = request.body as { orgName?: string };
    const validation = validateOrgName(orgName);
    if (!validation.success) {
      return reply.status(400).send({ error: validation.errors.join(', ') });
    }
    if (RESERVED_SCOPE_NAMES.has(orgName)) {
      return reply.status(400).send({ error: 'Organization name is reserved' });
    }
    if (await rejectIfNameTaken(orgName, reply)) return;

    const mode = platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
    if (mode === 'manual') {
      return reply.status(409).send({
        error: 'Organization registration requires approval on this platform; submit an application instead'
      });
    }

    // auto 模式：同步直调 Gitea 开通，创建者入 Owners 成为初始 Organization Admin。
    await initializeOrganization(giteaService, orgName, username, tenantOrganizationRepository);
    tenantOrganizationRepository.create({ orgName, status: 'active' });
    return reply.status(201).send({ orgName, status: 'active', role: 'org-admin' });
  });

  app.post('/api/orgs/applications', async (request, reply) => {
    const username = await requireSkillUser(request, reply);
    if (!username) return;

    const { orgName = '' } = request.body as { orgName?: string };
    const validation = validateOrgName(orgName);
    if (!validation.success) {
      return reply.status(400).send({ error: validation.errors.join(', ') });
    }
    if (RESERVED_SCOPE_NAMES.has(orgName)) {
      return reply.status(400).send({ error: 'Organization name is reserved' });
    }
    if (await rejectIfNameTaken(orgName, reply)) return;

    const mode = platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
    if (mode !== 'manual') {
      return reply.status(409).send({
        error: 'Organizations are created instantly on this platform; create one directly instead'
      });
    }
    try {
      const application = orgApplicationRepository.createApplication({
        orgName,
        applicantUsername: username
      });
      // 旧申请被拒绝后重提：租户记录已存在（rejected），回到待审而非新插。
      const tenant = tenantOrganizationRepository.get(orgName);
      if (tenant) {
        tenantOrganizationRepository.transition(orgName, 'pending');
      } else {
        tenantOrganizationRepository.create({ orgName, status: 'pending' });
      }
      return reply.status(201).send({ status: 'pending', applicationId: application.id, orgName });
    } catch (error) {
      if (String(error).toLowerCase().includes('unique')) {
        return reply.status(409).send({ error: 'An application for this organization already exists' });
      }
      throw error;
    }
  });

  app.post('/api/orgs/applications/:orgName/status', async (request, reply) => {
    // 申请人自助查询：只能看自己的申请与组织生命周期状态。
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    const username = await requireSkillUser(request, reply);
    if (!username) return;
    const application = orgApplicationRepository.getApplication(orgName);
    if (application && application.applicantUsername && application.applicantUsername !== username) {
      return reply.status(403).send({ error: 'Only the applicant may query this application' });
    }
    const tenant = tenantOrganizationRepository.get(orgName);
    if (!tenant && !application) {
      return reply.status(404).send({ error: 'Organization application not found' });
    }
    return { orgName, status: tenant?.status ?? application!.status };
  });
}
