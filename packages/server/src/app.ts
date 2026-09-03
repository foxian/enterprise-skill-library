import Fastify, { type FastifyInstance } from 'fastify';
import {
  AdminRepository,
  initDatabase,
  OperationAuditRepository,
  OperationRepository,
  OperationSecretRepository,
  OrgApplicationRepository,
  PlatformSettingsRepository,
  SkillRepository,
  TenantOrganizationRepository
} from './db/database.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerOrgRoutes } from './routes/orgs.js';
import { registerOrgAdminRoutes } from './routes/org-admin.js';
import { registerOrgConsoleRoutes } from './routes/org-console.js';
import { registerSkillsRoutes } from './routes/skills.js';
import type { GiteaService } from './services/gitea.js';
import path from 'node:path';
import { OperationExecutor } from './services/operation-executor.js';
import { initializeTenantOrganization } from './services/org-init.js';
import { runOrganizationDeletion } from './services/org-delete.js';
import { executePermissionChange, executeSkillCreation, type SkillCreationPayload } from './services/skill-operations.js';
import type { PermissionChangePayload } from './services/skill-operations.js';
import { decryptApplicationSecret } from './services/application-secret.js';
import { sanitizeOperationError } from './db/database.js';

export interface AppOptions {
  dbPath: string;
  packageRoot?: string;
  giteaService: GiteaService;
  repoOwner: string;
  bootstrapAdminToken?: string;
  passwordMinLength?: number;
  applicationEncryptionKey?: string;
}

const PENDING_APPLICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function buildApp(options: AppOptions): FastifyInstance {
  // bodyLimit matches the nginx client_max_body_size so publish requests carrying
  // the full source tree are not rejected by the 1MB Fastify default.
  const app = Fastify({ logger: false, bodyLimit: 200 * 1024 * 1024 });
  const db = initDatabase(options.dbPath);
  const repository = new SkillRepository(db);
  const adminRepository = new AdminRepository(db, options.bootstrapAdminToken ?? 'bootstrap-token');
  const orgApplicationRepository = new OrgApplicationRepository(db);
  const platformSettingsRepository = new PlatformSettingsRepository(db);
  const operationRepository = new OperationRepository(db);
  const operationSecretRepository = new OperationSecretRepository(db);
  const operationAuditRepository = new OperationAuditRepository(db);
  const tenantOrganizationRepository = new TenantOrganizationRepository(db);
  const operationExecutor = new OperationExecutor(operationRepository);
  operationExecutor.register('organization.provision', async (operation) => {
    const payload = operation.payload as {
      orgName: string;
      applicationId: number;
    };
    const application = orgApplicationRepository.getApplicationById(payload.applicationId);
    if (!application?.encryptedPassword || !options.applicationEncryptionKey) {
      throw new Error('Organization provisioning secret is unavailable');
    }
    const password = decryptApplicationSecret(application.encryptedPassword, options.applicationEncryptionKey);
    try {
      await initializeTenantOrganization(options.giteaService, payload.orgName, password);
      tenantOrganizationRepository.transition(payload.orgName, 'active');
      orgApplicationRepository.updateApplicationStatusById(payload.applicationId, 'approved');
      orgApplicationRepository.clearEncryptedPasswordById(payload.applicationId);
      operationAuditRepository.record({
        operationId: operation.id,
        event: 'organization.provision.succeeded'
      });
    } catch (error) {
      const failure = sanitizeOperationError(error);
      tenantOrganizationRepository.transition(payload.orgName, 'failed', failure);
      operationAuditRepository.record({
        operationId: operation.id,
        event: 'organization.provision.failed',
        details: failure
      });
      if (operation.attempts >= operation.maxAttempts) {
        orgApplicationRepository.clearEncryptedPasswordById(payload.applicationId);
      }
      throw error;
    }
  });
  operationExecutor.register('organization.delete', async (operation) => {
    const payload = operation.payload as { orgName: string };
    try {
      await runOrganizationDeletion(
        {
          giteaService: options.giteaService,
          skillRepository: repository,
          operationRepository,
          tenantOrganizationRepository,
          orgApplicationRepository
        },
        payload.orgName
      );
      operationAuditRepository.record({
        operationId: operation.id,
        event: 'organization.delete.succeeded'
      });
    } catch (error) {
      operationAuditRepository.record({
        operationId: operation.id,
        event: 'organization.delete.failed',
        details: sanitizeOperationError(error)
      });
      throw error;
    }
  });
  // 状态变更类操作本身没有外部副作用,作为审计锚点与幂等键存在。
  operationExecutor.register('organization.cancel', () => {});
  operationExecutor.register('organization.reject', () => {});
  operationExecutor.register('organization.expire', () => {});
  operationExecutor.register('skill.create', async (operation) => {
    await executeSkillCreation(
      { giteaService: options.giteaService, skillRepository: repository },
      operation.payload as SkillCreationPayload
    );
  });
  operationExecutor.register('skill.permission', async (operation) => {
    await executePermissionChange(
      { giteaService: options.giteaService },
      operation.payload as PermissionChangePayload
    );
  });
  operationExecutor.register('member.create', async (operation) => {
    const payload = operation.payload as { orgName: string; username: string };
    const password = readOperationSecret(operation.id);
    await options.giteaService.createUser(payload.username, password);
    for (const team of await options.giteaService.listTeams(payload.orgName)) {
      if (team.name === 'all-readers' || team.name === 'all-writers') {
        await options.giteaService.addTeamMember(team.id, payload.username);
      }
    }
    operationSecretRepository.clear(operation.id);
  });
  operationExecutor.register('member.disable', async (operation) => {
    const payload = operation.payload as { orgName: string; username: string };
    await options.giteaService.disableUser(payload.username);
    for (const team of await options.giteaService.listTeams(payload.orgName)) {
      await options.giteaService.removeTeamMember(team.id, payload.username);
    }
    await options.giteaService.removeOrgMember(payload.orgName, payload.username);
  });
  operationExecutor.register('member.enable', async (operation) => {
    const payload = operation.payload as { orgName: string; username: string };
    await options.giteaService.enableUser(payload.username);
    for (const team of await options.giteaService.listTeams(payload.orgName)) {
      if (team.name === 'all-readers' || team.name === 'all-writers') {
        await options.giteaService.addTeamMember(team.id, payload.username);
      }
    }
  });
  operationExecutor.register('member.password', async (operation) => {
    const payload = operation.payload as { username: string };
    await options.giteaService.changeUserPassword(payload.username, readOperationSecret(operation.id));
    operationSecretRepository.clear(operation.id);
  });
  expireStalePendingApplications();
  void operationExecutor.processPending();

  // pending 申请默认保留 30 天(ADR-0017):过期申请终止流程并立即清除密码密文。
  function expireStalePendingApplications(): void {
    const cutoff = new Date(Date.now() - PENDING_APPLICATION_TTL_MS).toISOString();
    for (const application of orgApplicationRepository.expireStalePending(cutoff)) {
      tenantOrganizationRepository.transition(application.orgName, 'expired');
      orgApplicationRepository.clearEncryptedPasswordById(application.id);
      // 过期没有外部副作用,Operation 仅承载幂等键与审计记录。
      const operation = operationRepository.createOperation({
        idempotencyKey: `organization.expire:${application.id}`,
        kind: 'organization.expire',
        payload: { orgName: application.orgName, applicationId: application.id }
      });
      operationAuditRepository.record({
        operationId: operation.id,
        event: 'organization.expire',
        details: { orgName: application.orgName }
      });
      void operationExecutor.process(operation.id);
    }
  }

  function readOperationSecret(operationId: number): string {
    const encryptedSecret = operationSecretRepository.get(operationId);
    if (!encryptedSecret || !options.applicationEncryptionKey) {
      throw new Error('Member operation secret is unavailable');
    }
    return decryptApplicationSecret(encryptedSecret, options.applicationEncryptionKey);
  }

  app.get('/health', async () => ({ ok: true, service: 'esl-api' }));
  app.get('/api/operations/:id', async (request, reply) => {
    // 供调用方查询自己触发的跨系统 Operation 状态(错误信息已脱敏)。
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('token ') ? authorization.replace('token ', '').trim() : '';
    const authenticated = token
      ? Boolean(adminRepository.validateUserToken(token) || (await options.giteaService.validateToken(token)))
      : false;
    if (!authenticated) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    const id = Number((request.params as { id: string }).id);
    const operation = operationRepository.getOperation(id);
    if (!operation) {
      return reply.status(404).send({ error: 'Operation not found' });
    }
    return {
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      error: operation.error,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt
    };
  });
  app.addHook('preHandler', async (request, reply) => {
    const routePath = request.url.split('?')[0];
    if (routePath === '/api/skills' || routePath.startsWith('/api/skills/')) {
      // 技能 Identity 形如 @scope/skill-name,scope 段即租户组织名;
      // POST /api/skills 的 Identity 在请求体中而非 URL。
      const urlSegment = decodeURIComponent(routePath.split('/')[3] ?? '');
      const bodyName = (request.body as { name?: string } | undefined)?.name ?? '';
      const scope = (urlSegment || bodyName).replace(/^@/, '').split('/')[0];
      const tenant = tenantOrganizationRepository.get(scope);
      if (tenant && tenant.status !== 'active') {
        return reply.status(409).send({
          error: `Organization is not active: ${scope}`,
          status: tenant.status
        });
      }
    }
    if (routePath === '/api/auth/login') {
      const username = (request.body as { username?: string } | undefined)?.username ?? '';
      const separator = username.indexOf('_');
      // 组织账号统一为 <org>_<name>,组织未激活时禁止其成员与组织管理员登录。
      if (separator > 0) {
        const tenant = tenantOrganizationRepository.get(username.slice(0, separator));
        if (tenant && tenant.status !== 'active') {
          return reply.status(409).send({
            error: `Organization is not active: ${tenant.orgName}`,
            status: tenant.status
          });
        }
      }
    }
  });
  registerAuthRoutes(app, {
    repository: adminRepository,
    giteaService: options.giteaService,
    passwordMinLength: options.passwordMinLength
  });
  registerOrgRoutes(app, {
    giteaService: options.giteaService,
    orgApplicationRepository,
    platformSettingsRepository,
    passwordMinLength: options.passwordMinLength,
    applicationEncryptionKey: options.applicationEncryptionKey,
    operationRepository,
    tenantOrganizationRepository,
    operationExecutor
  });
  registerOrgAdminRoutes(app, {
    giteaService: options.giteaService,
    orgApplicationRepository,
    platformSettingsRepository,
    skillRepository: repository,
    operationRepository,
    operationAuditRepository,
    tenantOrganizationRepository,
    operationExecutor,
    applicationEncryptionKey: options.applicationEncryptionKey
  });
  registerOrgConsoleRoutes(app, {
    giteaService: options.giteaService,
    passwordMinLength: options.passwordMinLength,
    operationRepository,
    operationSecretRepository,
    operationExecutor,
    tenantOrganizationRepository,
    applicationEncryptionKey: options.applicationEncryptionKey
  });
  registerAdminRoutes(app, {
    repository: adminRepository,
    giteaService: options.giteaService,
    repoOwner: options.repoOwner,
    passwordMinLength: options.passwordMinLength
  });
  registerSkillsRoutes(app, {
    repository,
    adminRepository,
    giteaService: options.giteaService,
    repoOwner: options.repoOwner,
    packageRoot: options.packageRoot ?? path.join(path.dirname(options.dbPath), 'packages'),
    operationRepository,
    operationExecutor
  });
  app.addHook('onClose', () => db.close());

  return app;
}
