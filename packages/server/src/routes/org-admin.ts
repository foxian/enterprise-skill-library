import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  OrgApplicationRepository,
  PlatformSettingsRepository,
  SkillRepository,
  OperationRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import type { OperationExecutor } from '../services/operation-executor.js';
import crypto from 'node:crypto';

export interface OrgAdminRouteOptions {
  giteaService: GiteaService;
  orgApplicationRepository: OrgApplicationRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  skillRepository: SkillRepository;
  operationRepository: OperationRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
  operationExecutor: OperationExecutor;
  applicationEncryptionKey?: string;
}
export function registerOrgAdminRoutes(app: FastifyInstance, options: OrgAdminRouteOptions): void {
  const { giteaService, orgApplicationRepository, platformSettingsRepository, skillRepository } = options;

  app.get('/api/admin/orgs/applications', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    return orgApplicationRepository.listApplications().map(toApplicationView);
  });

  app.post('/api/admin/orgs/applications/:id/approve', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const id = Number((request.params as { id: string }).id);
    const application = orgApplicationRepository.getApplicationById(id);
    if (!application) {
      return reply.status(404).send({ error: 'Organization application not found' });
    }
    if (application.status !== 'pending') {
      return reply.status(409).send({ error: 'Organization application has already been processed' });
    }
    if (await giteaService.organizationExists(application.orgName)) {
      return reply.status(409).send({ error: 'Organization name is already taken' });
    }

    if (!application.encryptedPassword || !options.applicationEncryptionKey) {
      // 兼容密钥接入前创建的历史申请；新申请一律走密文路径。
      if (!application.hashedPassword) {
        return reply.status(409).send({ error: 'Organization application secret is unavailable' });
      }
      const initialPassword = crypto.randomBytes(18).toString('base64url');
      try {
        await options.giteaService.createOrg(application.orgName);
        await options.giteaService.createUser(`${application.orgName}_admin`, initialPassword);
        const teams = await options.giteaService.listTeams(application.orgName);
        const ownersTeam = teams.find((team) => team.permission === 'owner' || team.permission === 'admin');
        if (!ownersTeam) throw new Error(`Gitea organization has no Owners team: ${application.orgName}`);
        await options.giteaService.addTeamMember(ownersTeam.id, `${application.orgName}_admin`);
        await options.giteaService.createTeam(application.orgName, 'all-readers', 'read');
        await options.giteaService.createTeam(application.orgName, 'all-writers', 'write');
        orgApplicationRepository.updateApplicationStatusById(id, 'approved');
        return { status: 'approved', orgName: application.orgName, initialPassword };
      } catch (error) {
        return reply.status(409).send({ error: `Organization initialization failed: ${(error as Error).message}` });
      }
    }
    const operation = options.operationRepository.createOperation({
      idempotencyKey: `organization.provision:${id}`,
      kind: 'organization.provision',
      payload: {
        orgName: application.orgName,
        applicationId: id
      }
    });
    const tenant = options.tenantOrganizationRepository.get(application.orgName);
    if (!tenant) {
      options.tenantOrganizationRepository.create({
        orgName: application.orgName,
        status: 'provisioning',
        operationId: operation.id
      });
    }
    void options.operationExecutor.process(operation.id);
    return { status: 'provisioning', orgName: application.orgName, operationId: operation.id };
  });

  app.post('/api/admin/orgs/applications/:id/reject', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const id = Number((request.params as { id: string }).id);
    const application = orgApplicationRepository.getApplicationById(id);
    if (!application) {
      return reply.status(404).send({ error: 'Organization application not found' });
    }
    if (application.status !== 'pending') {
      return reply.status(409).send({ error: 'Organization application has already been processed' });
    }
    const updated = orgApplicationRepository.updateApplicationStatusById(id, 'rejected');
    orgApplicationRepository.clearEncryptedPasswordById(id);
    const tenant = options.tenantOrganizationRepository.get(application.orgName);
    if (tenant) {
      options.tenantOrganizationRepository.transition(application.orgName, 'rejected');
    } else {
      options.tenantOrganizationRepository.create({ orgName: application.orgName, status: 'rejected' });
    }
    return { status: 'rejected', orgName: updated?.orgName ?? application.orgName };
  });

  app.get('/api/admin/orgs/settings', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    return { orgRegistrationMode: getRegistrationMode() };
  });

  app.put('/api/admin/orgs/settings', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const { orgRegistrationMode } = (request.body ?? {}) as { orgRegistrationMode?: string };
    if (orgRegistrationMode !== 'auto' && orgRegistrationMode !== 'manual') {
      return reply.status(400).send({ error: 'orgRegistrationMode must be auto or manual' });
    }
    platformSettingsRepository.setSetting('org_registration_mode', orgRegistrationMode);
    return { orgRegistrationMode };
  });

  app.get('/api/admin/orgs', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const orgs = await giteaService.listOrgs();
    return Promise.all(
      orgs.map(async (org) => ({
        name: org.name,
        memberCount: (await giteaService.listOrgMembers(org.name)).length,
        skillCount: skillRepository.countSkillsByScope(org.name),
        createdAt: org.created
      }))
    );
  });

  app.delete('/api/admin/orgs/:orgName', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    const { confirm } = (request.body ?? {}) as { confirm?: string };
    if (confirm !== orgName) {
      return reply.status(400).send({ error: 'Deletion requires confirm matching the organization name' });
    }
    // 只有 ESL 开通的组织(具备 Resource Provenance)才允许自动删除;
    // 未登记的组织(含平台组织)一律拒绝,防止误删外部资源。
    const tenant = options.tenantOrganizationRepository.get(orgName);
    if (!tenant) {
      return reply.status(404).send({ error: 'Organization not found or not managed by ESL' });
    }
    // 幂等键为组织名 + 删除:重复请求返回既有 Operation 状态,
    // 不重复执行删除副作用。
    const existing = options.operationRepository.getOperationByIdempotencyKey(
      `organization.delete:${orgName}`
    );
    if (existing) {
      return { status: existing.status, orgName, operationId: existing.id };
    }
    const operation = options.operationRepository.createOperation({
      idempotencyKey: `organization.delete:${orgName}`,
      kind: 'organization.delete',
      payload: { orgName }
    });
    options.tenantOrganizationRepository.transition(orgName, 'deleting');
    options.tenantOrganizationRepository.setOperationId(orgName, operation.id);
    void options.operationExecutor.process(operation.id);
    return reply.status(202).send({ status: 'deleting', orgName, operationId: operation.id });
  });

  app.post('/api/admin/operations/:id/retry', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const id = Number((request.params as { id: string }).id);
    const operation = options.operationRepository.retryOperation(id);
    if (!operation) return reply.status(404).send({ error: 'Retryable operation not found' });
    if (operation.kind === 'organization.delete') {
      const payload = operation.payload as { orgName: string };
      options.tenantOrganizationRepository.transition(payload.orgName, 'deleting');
    }
    void options.operationExecutor.process(id);
    return { status: 'pending', operationId: id };
  });

  function getRegistrationMode(): string {
    return platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
  }
}
function toApplicationView(application: {
  id: number;
  orgName: string;
  adminDisplayName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: application.id,
    orgName: application.orgName,
    adminDisplayName: application.adminDisplayName,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

async function requireSuperAdministrator(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService
): Promise<boolean> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send({ error: 'Unauthorized: missing token' });
    return false;
  }
  const token = authorization.replace('token ', '').trim();
  const admin = await giteaService.validateAdminUserToken(token);
  if (admin) return true;
  reply.status(403).send({ error: 'Forbidden: super administrator token required' });
  return false;
}
