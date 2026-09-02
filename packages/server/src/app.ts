import Fastify, { type FastifyInstance } from 'fastify';
import {
  AdminRepository,
  initDatabase,
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
import { decryptApplicationSecret } from './services/application-secret.js';

export interface AppOptions {
  dbPath: string;
  packageRoot?: string;
  giteaService: GiteaService;
  repoOwner: string;
  bootstrapAdminToken?: string;
  passwordMinLength?: number;
  applicationEncryptionKey?: string;
}

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tenantOrganizationRepository.transition(payload.orgName, 'failed', {
        code: 'PROVISIONING_FAILED',
        message,
        details: {}
      });
      if (operation.attempts >= operation.maxAttempts) {
        orgApplicationRepository.clearEncryptedPasswordById(payload.applicationId);
      }
      throw error;
    }
  });
  operationExecutor.register('organization.delete', async (operation) => {
    const payload = operation.payload as { orgName: string };
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
  void operationExecutor.processPending();

  function readOperationSecret(operationId: number): string {
    const encryptedSecret = operationSecretRepository.get(operationId);
    if (!encryptedSecret || !options.applicationEncryptionKey) {
      throw new Error('Member operation secret is unavailable');
    }
    return decryptApplicationSecret(encryptedSecret, options.applicationEncryptionKey);
  }

  app.get('/health', async () => ({ ok: true, service: 'esl-api' }));
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
    packageRoot: options.packageRoot ?? path.join(path.dirname(options.dbPath), 'packages')
  });
  app.addHook('onClose', () => db.close());

  return app;
}
