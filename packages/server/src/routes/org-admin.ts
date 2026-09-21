import { apiError } from '../errors.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  OrgApplicationRepository,
  PlatformSettingsRepository,
  SkillRepository,
  TenantOrganizationRepository,
  UserRegistrationRepository
} from '../db/database.js';
import type { GiteaService, GiteaUser } from '../services/gitea.js';
import { initializeOrganization } from '../services/org-init.js';
import { ORG_DELETION_TASK_ID, performOrganizationDeletion } from '../services/org-delete.js';
import {
  applyOrgIdentity,
  checkOwnerMemberInvariant,
  listOrgMembersWithIdentity,
  removeMemberFromOrganization
} from '../services/organization-membership.js';
import { validateOrgName, validatePassword } from '@esl/core';
import { logEvent, taskLogger } from '../logging.js';
import type { ApiErrorCode } from '@esl/i18n';

// 审批类治理事件（ADR-0045）：操作者是做出决定的管理员，资源是申请/注册记录。
// 状态流转是"关键业务事件"，普通查询（列表、详情）不记。
function logGovernanceEvent(
  request: FastifyRequest,
  actorUsername: string,
  event: 'organization.application' | 'user.registration' | 'organization.delete',
  outcome: 'succeeded' | 'failed',
  resourceType: string,
  resourceId: string,
  message: string,
  errorCode?: ApiErrorCode,
  organization?: string
): void {
  logEvent(
    request.log,
    outcome === 'succeeded' ? 'info' : 'warn',
    {
      event,
      outcome,
      actorUsername,
      ...(organization ? { organization } : {}),
      resourceType,
      resourceId,
      ...(errorCode ? { errorCode } : {})
    },
    message
  );
}

export interface OrgAdminRouteOptions {
  giteaService: GiteaService;
  orgApplicationRepository: OrgApplicationRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  skillRepository: SkillRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
  userRegistrationRepository: UserRegistrationRepository;
}
export function registerOrgAdminRoutes(app: FastifyInstance, options: OrgAdminRouteOptions): void {
  const { giteaService, orgApplicationRepository, platformSettingsRepository, skillRepository } = options;

  app.get('/api/admin/orgs/applications', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    return orgApplicationRepository.listApplications().map(toApplicationView);
  });

  app.post('/api/admin/orgs/applications/:id/approve', async (request, reply) => {
    const admin = await requireSuperAdministrator(request, reply, giteaService);
    if (!admin) return;
    const id = Number((request.params as { id: string }).id);
    const application = orgApplicationRepository.getApplicationById(id);
    if (!application) {
      return reply.status(404).send(apiError('organizationApplicationNotFound'));
    }
    if (application.status !== 'pending') {
      return reply.status(409).send(apiError('organizationApplicationHasAlreadyBeenProcessed'));
    }
    if (await giteaService.organizationExists(application.orgName)) {
      return reply.status(409).send(apiError('organizationNameIsAlreadyTaken'));
    }

    // ADR-0032：审批只是申请表上的状态翻转 + 同步开通，异步 Operation 机器退役。
    // 申请人为已登录 Skill User，批准后即成为初始所有者成员（ADR-0038）。
    const applicant = application.applicantUsername ?? admin.username;
    try {
      await initializeOrganization(options.giteaService, application.orgName, applicant, options.tenantOrganizationRepository);
      options.tenantOrganizationRepository.transition(application.orgName, 'active');
      orgApplicationRepository.updateApplicationStatusById(id, 'approved');
    } catch (error) {
      options.tenantOrganizationRepository.transition(application.orgName, 'failed');
      logGovernanceEvent(
        request,
        admin.username,
        'organization.application',
        'failed',
        'organization',
        application.orgName,
        'Organization application approval failed',
        'organizationInitializationFailed',
        application.orgName
      );
      return reply.status(409).send(apiError('organizationInitializationFailed', { detail: (error as Error).message }));
    }
    logGovernanceEvent(
      request,
      admin.username,
      'organization.application',
      'succeeded',
      'organization',
      application.orgName,
      'Organization application approved',
      undefined,
      application.orgName
    );
    return { status: 'active', orgName: application.orgName, applicant };
  });

  app.post('/api/admin/orgs/applications/:id/reject', async (request, reply) => {
    const admin = await requireSuperAdministrator(request, reply, giteaService);
    if (!admin) return;
    const id = Number((request.params as { id: string }).id);
    const application = orgApplicationRepository.getApplicationById(id);
    if (!application) {
      return reply.status(404).send(apiError('organizationApplicationNotFound'));
    }
    if (application.status !== 'pending') {
      return reply.status(409).send(apiError('organizationApplicationHasAlreadyBeenProcessed'));
    }
    // 拒绝即释放名字（ADR-0032）：组织从未开通，状态翻转即可，无外部副作用。
    const updated = orgApplicationRepository.updateApplicationStatusById(id, 'rejected');
    const tenant = options.tenantOrganizationRepository.get(application.orgName);
    if (tenant) {
      options.tenantOrganizationRepository.transition(application.orgName, 'rejected');
    }
    logGovernanceEvent(
      request,
      admin.username,
      'organization.application',
      'succeeded',
      'organization',
      application.orgName,
      'Organization application rejected',
      undefined,
      application.orgName
    );
    return { status: 'rejected', orgName: updated?.orgName ?? application.orgName };
  });

  app.post('/api/admin/orgs/applications/:id/cancel', async (request, reply) => {
    const admin = await requireSuperAdministrator(request, reply, giteaService);
    if (!admin) return;
    const id = Number((request.params as { id: string }).id);
    const application = orgApplicationRepository.getApplicationById(id);
    if (!application) {
      return reply.status(404).send(apiError('organizationApplicationNotFound'));
    }
    if (application.status !== 'pending') {
      return reply.status(409).send(apiError('onlyPendingApplicationsCanBeCancelled'));
    }
    // 取消即释放名字（ADR-0032）：状态翻转，无外部副作用。
    orgApplicationRepository.updateApplicationStatusById(id, 'cancelled');
    // 取消只撤回待审申请；组织从未开通（ADR-0032 取消即释放名字）。
    const tenant = options.tenantOrganizationRepository.get(application.orgName);
    if (tenant && tenant.status === 'pending') {
      options.tenantOrganizationRepository.transition(application.orgName, 'cancelled');
    }
    return { status: 'cancelled', orgName: application.orgName };
  });

  app.get('/api/admin/orgs/settings', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    return {
      orgRegistrationMode: getRegistrationMode(),
      registrationMode: getUserRegistrationMode(),
      memberAddMode: getMemberAddMode()
    };
  });

  app.put('/api/admin/orgs/settings', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const body = (request.body ?? {}) as {
      orgRegistrationMode?: string;
      registrationMode?: string;
      memberAddMode?: string;
    };

    if (body.orgRegistrationMode !== undefined) {
      if (body.orgRegistrationMode !== 'auto' && body.orgRegistrationMode !== 'manual') {
        return reply.status(400).send(apiError('orgregistrationmodeMustBeAutoOrManual'));
      }
    }
    if (body.registrationMode !== undefined) {
      if (body.registrationMode !== 'open' && body.registrationMode !== 'approval') {
        return reply.status(400).send(apiError('registrationmodeMustBeOpenOrApproval'));
      }
    }
    if (body.memberAddMode !== undefined) {
      if (body.memberAddMode !== 'direct' && body.memberAddMode !== 'invite') {
        return reply.status(400).send(apiError('memberaddmodeMustBeDirectOrInvite'));
      }
    }

    if (body.orgRegistrationMode !== undefined) {
      platformSettingsRepository.setSetting('org_registration_mode', body.orgRegistrationMode);
    }
    if (body.registrationMode !== undefined) {
      platformSettingsRepository.setSetting('registration_mode', body.registrationMode);
    }
    if (body.memberAddMode !== undefined) {
      platformSettingsRepository.setSetting('member_add_mode', body.memberAddMode);
    }
    return {
      orgRegistrationMode: getRegistrationMode(),
      registrationMode: getUserRegistrationMode(),
      memberAddMode: getMemberAddMode()
    };
  });

  // 用户注册审批（ADR-0032）：approval 模式下账号注册时即以禁用态存在，
  // 批准 = 解禁登录；拒绝 = 删除 Gitea 账号，名字随之释放。
  app.get('/api/admin/registrations', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const status = (request.query as { status?: string }).status;
    const records =
      status === 'pending' || status === 'approved' || status === 'rejected'
        ? options.userRegistrationRepository.listByStatus(status)
        : options.userRegistrationRepository.listByStatus('pending');
    return records;
  });

  app.post('/api/admin/registrations/:id/approve', async (request, reply) => {
    const admin = await requireSuperAdministrator(request, reply, giteaService);
    if (!admin) return;
    const id = Number((request.params as { id: string }).id);
    const registration = options.userRegistrationRepository.getById(id);
    if (!registration) {
      return reply.status(404).send(apiError('registrationNotFound'));
    }
    if (registration.status !== 'pending') {
      return reply.status(409).send(apiError('registrationHasAlreadyBeenProcessed'));
    }
    await giteaService.enableUser(registration.username);
    const updated = options.userRegistrationRepository.updateStatusById(id, 'approved');
    logGovernanceEvent(
      request,
      admin.username,
      'user.registration',
      'succeeded',
      'user',
      registration.username,
      'User registration approved'
    );
    return { status: 'approved', username: registration.username, registrationId: updated?.id };
  });

  app.post('/api/admin/registrations/:id/reject', async (request, reply) => {
    const admin = await requireSuperAdministrator(request, reply, giteaService);
    if (!admin) return;
    const id = Number((request.params as { id: string }).id);
    const registration = options.userRegistrationRepository.getById(id);
    if (!registration) {
      return reply.status(404).send(apiError('registrationNotFound'));
    }
    if (registration.status !== 'pending') {
      return reply.status(409).send(apiError('registrationHasAlreadyBeenProcessed'));
    }
    // 删除账号即释放名字；记录保留为 rejected 供审计。
    await giteaService.deleteUser(registration.username);
    const updated = options.userRegistrationRepository.updateStatusById(id, 'rejected');
    logGovernanceEvent(
      request,
      admin.username,
      'user.registration',
      'succeeded',
      'user',
      registration.username,
      'User registration rejected'
    );
    return { status: 'rejected', username: registration.username, registrationId: updated?.id };
  });

  app.get('/api/admin/orgs', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const orgs = await giteaService.listOrgs();
    const tenants = options.tenantOrganizationRepository.listAll();
    const tenantByName = new Map(tenants.map((tenant) => [tenant.orgName, tenant]));
    const views = await Promise.all(
      orgs.map(async (org) => {
        const tenant = tenantByName.get(org.name);
        return {
          name: org.name,
          memberCount: (await giteaService.listOrgMembers(org.name)).length,
          skillCount: skillRepository.countSkillsByScope(org.name),
          createdAt: org.created,
          status: tenant?.status ?? null,
          lastError: tenant?.lastError ?? null
        };
      })
    );
    // 开通在 Gitea 建组织之前失败的组织不会出现在 Git Backend 列表中,
    // 从租户状态表补充,保证失败原因与重试入口可达。
    const listed = new Set(orgs.map((org) => org.name));
    for (const tenant of tenants) {
      if (listed.has(tenant.orgName) || tenant.status === 'deleted') continue;
      views.push({
        name: tenant.orgName,
        memberCount: 0,
        skillCount: skillRepository.countSkillsByScope(tenant.orgName),
        createdAt: tenant.createdAt,
        status: tenant.status,
        lastError: tenant.lastError
      });
    }
    return views;
  });

  app.delete('/api/admin/orgs/:orgName', async (request, reply) => {
    const admin = await requireSuperAdministrator(request, reply, giteaService);
    if (!admin) return;
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    const { confirm } = (request.body ?? {}) as { confirm?: string };
    if (confirm !== orgName) {
      return reply.status(400).send(apiError('deletionRequiresConfirmMatchingTheOrganizationName'));
    }
    // 只有 ESL 开通的组织才允许自动删除;未登记的组织一律拒绝,防止误删外部资源。
    const tenant = options.tenantOrganizationRepository.get(orgName);
    if (!tenant) {
      return reply.status(404).send(apiError('organizationNotFoundOrNotManagedByEsl'));
    }
    // 同步删除（ADR-0032）：Git Backend 清理 + 平台记录一次完成，不再走
    // 可恢复工作流；失败原样返回，管理员重试即可。
    try {
      await performOrganizationDeletion(
        {
          giteaService: options.giteaService,
          skillRepository: options.skillRepository,
          tenantOrganizationRepository: options.tenantOrganizationRepository
        },
        orgName,
        // 请求内后台任务：子 logger 带 taskId 与触发请求 id，任务日志可回到
        // 原始请求的时间线（US37/US38）。
        taskLogger(request.log, ORG_DELETION_TASK_ID, request.id)
      );
    } catch (error) {
      // 失败原因已由删除流程写入租户状态（delete_failed + lastError）
      return reply.status(409).send({ ...apiError('organizationDeletionFailed', { detail: (error as Error).message }), retryable: true });
    }
    return { status: 'deleted', orgName };
  });

  // 平台管理员的组织身份兜底（ADR-0038）：超管不参与组织（不属于任何组织、不入
  // 组织管理团队），因此不能走组织侧路由；这里给出不经成员身份的同款查看、变更、
  // 移除能力。"组织必须至少保留一名所有者成员"这条不变量对超管同样成立——无主
  // 组织不是可治理状态，超管也无"自己"，故不适用自我退出限制。
  app.get('/api/admin/orgs/:orgName/members', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    if (!(await giteaService.organizationExists(orgName))) {
      return reply.status(404).send(apiError('organizationNotFound'));
    }
    return listOrgMembersWithIdentity(giteaService, orgName);
  });

  // 与组织侧的唯一差别是**空降**：组织里确实无人可用时，超管可以把组织外的人直接
  // 设为所有者成员。没有这条，只剩"整体删除"这一条不可逆的死路——而删除是本该
  // 最后才动的手段（ADR-0038）。
  app.put('/api/admin/orgs/:orgName/members/:username/identity', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    const username = decodeURIComponent((request.params as { username: string }).username);
    const { identity } = (request.body ?? {}) as { identity?: string };
    if (identity !== 'ordinary' && identity !== 'managing' && identity !== 'owner') {
      return reply.status(400).send(apiError('identityMustBeOrdinaryManagingOrOwner'));
    }
    if (!(await giteaService.organizationExists(orgName))) {
      return reply.status(404).send(apiError('organizationNotFound'));
    }
    const isMember = (await giteaService.listOrgMembers(orgName)).some(
      (member) => member.username === username
    );
    if (!isMember) {
      // 空降只对"设为所有者成员"开放：兜底要救的是组织里没有可用管理者，这种局面
      // 下组织成员也可能一个都不剩。
      if (identity !== 'owner') {
        return reply.status(404).send(apiError('userIsNotMemberOf', { org: orgName }));
      }
      if (!(await giteaService.getUser(username))) {
        return reply.status(404).send(apiError('userDoesNotExist', { username }));
      }
    }
    const blocked = await checkOwnerMemberInvariant(giteaService, orgName, username, identity);
    if (blocked) {
      return reply.status(400).send(apiError('validationFailed', { detail: blocked }));
    }
    // applyOrgIdentity 会把对方挂进常设团队，而 Git Backend 由团队挂载建立组织
    // 隶属关系——不需要（也没有）单独的"加入组织"调用。
    await applyOrgIdentity(giteaService, orgName, username, identity);
    return { username, identity };
  });

  app.delete('/api/admin/orgs/:orgName/members/:username', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    const username = decodeURIComponent((request.params as { username: string }).username);
    if (!(await giteaService.organizationExists(orgName))) {
      return reply.status(404).send(apiError('organizationNotFound'));
    }
    if (!(await giteaService.listOrgMembers(orgName)).some((member) => member.username === username)) {
      return reply.status(404).send(apiError('userIsNotMemberOf', { org: orgName }));
    }
    const blocked = await checkOwnerMemberInvariant(giteaService, orgName, username, null);
    if (blocked) {
      return reply.status(400).send(apiError('validationFailed', { detail: blocked }));
    }
    await removeMemberFromOrganization(giteaService, orgName, username);
    return { removed: true, orgName, username };
  });

  function getRegistrationMode(): string {
    return platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
  }

  function getUserRegistrationMode(): string {
    return platformSettingsRepository.getSetting('registration_mode') ?? 'open';
  }

  function getMemberAddMode(): string {
    return platformSettingsRepository.getSetting('member_add_mode') ?? 'direct';
  }
}
function toApplicationView(application: {
  id: number;
  orgName: string;
  applicantUsername: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: application.id,
    orgName: application.orgName,
    applicantUsername: application.applicantUsername,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

async function requireSuperAdministrator(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService
): Promise<GiteaUser | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send(apiError('unauthorizedMissingToken'));
    return null;
  }
  const token = authorization.replace('token ', '').trim();
  const admin = await giteaService.validateAdminUserToken(token);
  if (admin) return admin;
  reply.status(403).send(apiError('forbiddenSuperAdministratorTokenRequired'));
  return null;
}
