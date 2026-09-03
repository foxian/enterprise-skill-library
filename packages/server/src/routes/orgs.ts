import { validateOrgName, validatePassword } from '@esl/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  OperationRepository,
  OrgApplicationRepository,
  PlatformSettingsRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import type { OperationExecutor } from '../services/operation-executor.js';
import { decryptApplicationSecret, encryptApplicationSecret } from '../services/application-secret.js';

export interface OrgRouteOptions {
  giteaService: GiteaService;
  orgApplicationRepository: OrgApplicationRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  passwordMinLength?: number;
  applicationEncryptionKey?: string;
  operationRepository: OperationRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
  operationExecutor: OperationExecutor;
}

export function registerOrgRoutes(app: FastifyInstance, options: OrgRouteOptions): void {
  const { giteaService, orgApplicationRepository, platformSettingsRepository } = options;

  app.post('/api/orgs/applications/:orgName/status', async (request, reply) => {
    // 申请人自助查询:只能看到申请与组织生命周期状态,不暴露任何凭据材料。
    // 归属证明:申请密码密文仍存在时,必须提供申请时设置的初始密码。
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    const tenant = options.tenantOrganizationRepository.get(orgName);
    const application = orgApplicationRepository.getApplication(orgName);
    if (!tenant && !application) {
      return reply.status(404).send({ error: 'Organization application not found' });
    }
    if (application?.encryptedPassword && options.applicationEncryptionKey) {
      const { password = '' } = (request.body ?? {}) as { password?: string };
      if (!password) {
        return reply.status(401).send({ error: 'Applicant password is required to query the application status' });
      }
      const expected = decryptApplicationSecret(application.encryptedPassword, options.applicationEncryptionKey);
      if (password !== expected) {
        return reply.status(403).send({ error: 'Applicant password does not match' });
      }
    }
    return { orgName, status: tenant?.status ?? application!.status };
  });

  app.post('/api/orgs/apply', async (request, reply) => {
    // 管理员身份固定为 admin(ADR-0017):adminDisplayName 无业务用途,
    // 兼容旧客户端仍可携带,但服务端不再要求也不采用。
    const { orgName = '', password = '' } = request.body as {
      orgName?: string;
      adminDisplayName?: string;
      password?: string;
    };
    if (!orgName || !password) {
      return reply.status(400).send({ error: 'orgName and password are required' });
    }

    const validation = validateOrgName(orgName);
    if (!validation.success) {
      return reply.status(400).send({ error: validation.errors.join(', ') });
    }
    const passwordValidation = validatePassword(password, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }

    if (await giteaService.organizationExists(orgName)) {
      return reply.status(409).send({ error: 'Organization name is already taken' });
    }

    const mode = platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
    if (!options.applicationEncryptionKey) {
      return reply.status(503).send({
        error: 'Organization registration is unavailable without application encryption key'
      });
    }

    try {
      const application = orgApplicationRepository.createApplication({
        orgName,
        adminDisplayName: 'admin',
        encryptedPassword: encryptApplicationSecret(password, options.applicationEncryptionKey)
      });
      const operation = options.operationRepository.createOperation({
        idempotencyKey: `organization.provision:${application.id}`,
        kind: 'organization.provision',
        payload: {
          orgName,
          applicationId: application.id
        }
      });
      options.tenantOrganizationRepository.create({
        orgName,
        status: mode === 'manual' ? 'pending' : 'provisioning',
        operationId: operation.id
      });
      if (mode === 'auto') {
        void options.operationExecutor.process(operation.id);
      }
      return reply.status(201).send(
        mode === 'manual'
          ? { status: 'pending', applicationId: application.id }
          : { status: 'provisioning', operationId: operation.id }
      );
    } catch (error) {
      if (String(error).toLowerCase().includes('unique')) {
        return reply.status(409).send({ error: 'An application for this organization already exists' });
      }
      throw error;
    }
  });
}
