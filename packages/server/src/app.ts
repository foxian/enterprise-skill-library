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
    try {
      const members = await options.giteaService.listOrgMembers(payload.orgName);
      const repos = await options.giteaService.listOrgRepos(payload.orgName);
      for (const repo of repos) {
        await options.giteaService.deleteRepo(payload.orgName, repo.name);
      }
      for (const member of members) {
        if (member.username.startsWith(`${payload.orgName}_`)) {
          await options.giteaService.deleteUser(member.username);
        }
      }
      await options.giteaService.deleteOrg(payload.orgName);
      repository.deleteSkillsByScope(payload.orgName);
      tenantOrganizationRepository.transition(payload.orgName, 'deleted');
    } catch (error) {
      tenantOrganizationRepository.transition(payload.orgName, 'delete_failed', {
        code: 'DELETE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        details: {}
      });
      throw error;
    }
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
    if (request.url.startsWith('/api/skills/')) {
      const scope = decodeURIComponent(request.url.split('/')[3]?.split('?')[0] ?? '');
      const tenant = tenantOrganizationRepository.get(scope);
      if (tenant && tenant.status !== 'active') {
        return reply.status(409).send({
          error: `Organization is not active: ${scope}`,
          status: tenant.status
        });
      }
    }
    if (request.url === '/api/auth/login') {
      const username = (request.body as { username?: string } | undefined)?.username ?? '';
      const suffix = '_admin';
      if (username.endsWith(suffix)) {
        const tenant = tenantOrganizationRepository.get(username.slice(0, -suffix.length));
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
