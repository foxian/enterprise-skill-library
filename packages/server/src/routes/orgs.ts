import { apiError } from '../errors.js';
import { RESERVED_SCOPE_NAMES, validateOrgName } from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  OrgApplicationRepository,
  PlatformSettingsRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { initializeOrganization } from '../services/org-init.js';
import { deriveOrganizations } from '../services/organization-membership.js';
import { logEvent } from '../logging.js';
import type { ApiErrorCode } from '@esl/i18n';

export interface OrgRouteOptions {
  giteaService: GiteaService;
  orgApplicationRepository: OrgApplicationRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
}

// 组织治理的对外结果事件（ADR-0045）：只在名称占用/状态流转等业务状态变化时
// 记录，普通读请求不产生事件。错误码与响应体里的 API Error Code 对齐，便于把
// 客户端看到的拒绝与服务端日志关联起来。
function logOrganizationOutcome(
  request: FastifyRequest,
  actorUsername: string,
  orgName: string,
  outcome: 'succeeded' | 'failed',
  errorCode?: ApiErrorCode
): void {
  logEvent(
    request.log,
    outcome === 'succeeded' ? 'info' : 'warn',
    {
      event: 'organization.create',
      outcome,
      actorUsername,
      organization: orgName,
      resourceType: 'organization',
      resourceId: orgName,
      ...(errorCode ? { errorCode } : {})
    },
    outcome === 'succeeded' ? 'Organization created' : 'Organization creation rejected'
  );
}

// 组织注册申请（manual 模式）的结果事件：申请提交与随后的审批是两条独立时间线，
// 用不同事件名区分。
function logOrganizationApplication(
  request: FastifyRequest,
  actorUsername: string,
  orgName: string,
  outcome: 'succeeded' | 'failed',
  errorCode?: ApiErrorCode
): void {
  logEvent(
    request.log,
    outcome === 'succeeded' ? 'info' : 'warn',
    {
      event: 'organization.application',
      outcome,
      actorUsername,
      organization: orgName,
      resourceType: 'organization',
      resourceId: orgName,
      ...(errorCode ? { errorCode } : {})
    },
    outcome === 'succeeded' ? 'Organization application submitted' : 'Organization application rejected'
  );
}

// 组织创建（ADR-0032）：任何已注册用户可创建多个组织，方式由平台设置
// org_registration_mode 决定——auto 同步即时创建；manual 提交申请、超管批准后
// 同步开通。申请提交时即按扁平命名池查重，冲突不会到达审批环节。
export function registerOrgRoutes(app: FastifyInstance, options: OrgRouteOptions): void {
  const { giteaService, orgApplicationRepository, platformSettingsRepository, tenantOrganizationRepository } = options;

  async function requireSkillUser(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('token ')) {
      reply.status(401).send(apiError('unauthorizedMissingToken'));
      return null;
    }
    const user = await giteaService.validateToken(authorization.replace('token ', '').trim());
    if (!user) {
      reply.status(401).send(apiError('unauthorizedInvalidToken'));
      return null;
    }
    return user.username;
  }

  // 扁平命名池查重（先到先得）：已存在组织 / 用户 / 保留名 / 同名待审申请。
  async function rejectIfNameTaken(
    request: FastifyRequest,
    reply: FastifyReply,
    orgName: string,
    username: string
  ): Promise<boolean> {
    const reject = (code: ApiErrorCode): true => {
      logOrganizationOutcome(request, username, orgName, 'failed', code);
      reply.status(409).send(apiError(code));
      return true;
    };
    if (await giteaService.organizationExists(orgName)) {
      return reject('organizationNameIsAlreadyTaken');
    }
    if (await giteaService.getUser(orgName)) {
      return reject('organizationNameCollidesWithAnExistingUser');
    }
    if (orgApplicationRepository.getApplication(orgName)?.status === 'pending') {
      return reject('anApplicationForThisOrganizationNameIsAlreadyPending');
    }
    return false;
  }

  // 个人控制台「我的组织」的数据源（ADR-0035）：本人所在的组织与逐组织治理权，
  // 外加本人的待审组织申请。待审申请尚未产生 Gitea 组织，因此不在 organizations
  // 里，单独列出；新建组织后当前会话还不知道它，也靠这里刷新。
  app.get('/api/orgs/mine', async (request, reply) => {
    const username = await requireSkillUser(request, reply);
    if (!username) return;
    const pendingApplications = orgApplicationRepository
      .listApplications('pending')
      .filter((application) => application.applicantUsername === username)
      .map((application) => ({ orgName: application.orgName, submittedAt: application.createdAt }));
    return {
      // 附带组织生命周期状态：deleting / delete_failed 是治理者必须看见的状态
      // （ADR-0034 的删除失败要可察觉、可重试），不能只显示"在"或"不在"。
      organizations: (await deriveOrganizations(giteaService, username)).map((membership) => ({
        ...membership,
        status: tenantOrganizationRepository.get(membership.org)?.status ?? 'active'
      })),
      pendingApplications
    };
  });

  app.post('/api/orgs', async (request, reply) => {
    const username = await requireSkillUser(request, reply);
    if (!username) return;

    const { orgName = '' } = request.body as { orgName?: string };
    const validation = validateOrgName(orgName);
    if (!validation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: validation.errors.join(', ') }));
    }
    if (RESERVED_SCOPE_NAMES.has(orgName)) {
      logOrganizationOutcome(request, username, orgName, 'failed', 'organizationNameIsReserved');
      return reply.status(400).send(apiError('organizationNameIsReserved'));
    }
    if (await rejectIfNameTaken(request, reply, orgName, username)) return;

    const mode = platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
    if (mode === 'manual') {
      logOrganizationOutcome(
        request,
        username,
        orgName,
        'failed',
        'organizationRegistrationRequiresApprovalOnThisPlatformSubmitAnApplicationInstead'
      );
      return reply.status(409).send({
        ...apiError('organizationRegistrationRequiresApprovalOnThisPlatformSubmitAnApplicationInstead')
      });
    }

    // auto 模式：同步直调 Gitea 开通，创建者入组织管理团队（Gitea Owners）成为初始成员。
    await initializeOrganization(giteaService, orgName, username, tenantOrganizationRepository);
    tenantOrganizationRepository.create({ orgName, status: 'active' });
    logOrganizationOutcome(request, username, orgName, 'succeeded');
    return reply.status(201).send({ orgName, status: 'active', identity: 'owner', isOwnerMember: true });
  });

  app.post('/api/orgs/applications', async (request, reply) => {
    const username = await requireSkillUser(request, reply);
    if (!username) return;

    const { orgName = '' } = request.body as { orgName?: string };
    const validation = validateOrgName(orgName);
    if (!validation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: validation.errors.join(', ') }));
    }
    if (RESERVED_SCOPE_NAMES.has(orgName)) {
      logOrganizationApplication(request, username, orgName, 'failed', 'organizationNameIsReserved');
      return reply.status(400).send(apiError('organizationNameIsReserved'));
    }
    if (await rejectIfNameTaken(request, reply, orgName, username)) return;

    const mode = platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
    if (mode !== 'manual') {
      logOrganizationApplication(
        request,
        username,
        orgName,
        'failed',
        'organizationsAreCreatedInstantlyOnThisPlatformCreateOneDirectlyInstead'
      );
      return reply.status(409).send({
        ...apiError('organizationsAreCreatedInstantlyOnThisPlatformCreateOneDirectlyInstead')
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
      logOrganizationApplication(request, username, orgName, 'succeeded');
      return reply.status(201).send({ status: 'pending', applicationId: application.id, orgName });
    } catch (error) {
      if (String(error).toLowerCase().includes('unique')) {
        logOrganizationApplication(
          request,
          username,
          orgName,
          'failed',
          'anApplicationForThisOrganizationAlreadyExists'
        );
        return reply.status(409).send(apiError('anApplicationForThisOrganizationAlreadyExists'));
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
      return reply.status(403).send(apiError('onlyTheApplicantMayQueryThisApplication'));
    }
    const tenant = tenantOrganizationRepository.get(orgName);
    if (!tenant && !application) {
      return reply.status(404).send(apiError('organizationApplicationNotFound'));
    }
    return { orgName, status: tenant?.status ?? application!.status };
  });
}
