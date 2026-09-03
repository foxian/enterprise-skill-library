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
import { encryptApplicationSecret } from '../services/application-secret.js';

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

  app.get('/api/orgs/applications/:orgName/status', async (request, reply) => {
    // 申请人自助查询:只暴露申请与组织生命周期状态,不暴露任何凭据材料。
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    const tenant = options.tenantOrganizationRepository.get(orgName);
    if (tenant) {
      return { orgName, status: tenant.status };
    }
    const application = orgApplicationRepository.getApplication(orgName);
    if (application) {
      return { orgName, status: application.status };
    }
    return reply.status(404).send({ error: 'Organization application not found' });
  });

  app.post('/api/orgs/apply', async (request, reply) => {
    const { orgName = '', adminDisplayName = '', password = '' } = request.body as {
      orgName?: string;
      adminDisplayName?: string;
      password?: string;
    };
    if (!orgName || !adminDisplayName || !password) {
      return reply.status(400).send({ error: 'orgName, adminDisplayName, and password are required' });
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
        adminDisplayName,
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
