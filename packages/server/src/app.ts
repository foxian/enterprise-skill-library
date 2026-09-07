import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  AdminRepository,
  initDatabase,
  OperationAuditRepository,
  OperationRecord,
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
import { executeSkillCreation, executePermissionChange } from './services/skill-operations.js';
import type { PermissionChangePayload, SkillCreationPayload } from './services/skill-operations.js';
import { decryptApplicationSecret } from './services/application-secret.js';
import { sanitizeOperationError } from './db/database.js';
import { seedDevelopmentData } from './seed.js';
import { OperationEventBus } from './services/operation-events.js';
import { readDefaultOrg, readDeploymentMode, readPlatformInfo, resolveUsernameOrg } from './services/platform-config.js';
import { ensureDeclaredOrgBootstrap } from './services/single-org-bootstrap.js';

export interface AppOptions {
  dbPath: string;
  packageRoot?: string;
  giteaService: GiteaService;
  repoOwner: string;
  passwordMinLength?: number;
  applicationEncryptionKey?: string;
  // When true, sample skill metadata is seeded into the database at startup
  // (ESL_AUTO_SEED). Seeding is idempotent and only inserts development data.
  autoSeed?: boolean;
  // Injectable Operation event bus (test seam); defaults to a new in-process bus.
  operationEventBus?: OperationEventBus;
  // 默认组织部署声明(ADR-0022):由 startServer 从环境变量解析后传入,两种部署
  // 模式都支持——声明了就在 onReady 时直接 Provisioning 默认组织并写入部署
  // 模式与默认组织设置。测试构建不传,不触发。
  declaredOrgBootstrap?: { orgName: string; adminPassword: string; deploymentMode: 'single' | 'multi' };
}

const PENDING_APPLICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 统一的 token → 调用方身份解析:token 可来自平台管理员、Skill User 或 Gitea
// 用户,DB 内先查(已登记 token,无网络往返)再回退 Gitea。单组织门禁与
// Operation 查询/订阅共用此实现,保证冻结判断与路由鉴权一致。
async function resolveAuthedUser(
  token: string,
  adminRepository: AdminRepository,
  giteaService: GiteaService
): Promise<{ username: string | null; isPlatformAdmin: boolean }> {
  const platformAdmin = token ? adminRepository.getPlatformAdminForToken(token) : null;
  const eslUser = token ? adminRepository.validateUserToken(token) : null;
  const giteaUser = eslUser ? null : await giteaService.validateToken(token);
  const username = platformAdmin?.username ?? eslUser?.username ?? giteaUser?.username ?? null;
  // Gitea 管理员账号(默认 eslroot)是平台超级管理员:admin_users 表只把内置
  // 'admin' 标记为 platform_admin,而 ESL 实际管理员是 GITEA_ADMIN_USERNAME,
  // 需按 Gitea 管理员身份补齐判定,否则管理后台发起的 Operation 流订阅会被 403。
  const isAdminByGitea = username !== null && username === giteaService.adminUsername;
  return { username, isPlatformAdmin: Boolean(platformAdmin) || isAdminByGitea };
}

// 解析 Operation 查询/订阅请求的调用方身份;无有效 token 即匿名。
async function resolveOperationRequester(
  request: FastifyRequest,
  adminRepository: AdminRepository,
  giteaService: GiteaService
): Promise<{ username: string | null; isPlatformAdmin: boolean }> {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith('token ') ? authorization.replace('token ', '').trim() : '';
  return resolveAuthedUser(token, adminRepository, giteaService);
}

export function buildApp(options: AppOptions): FastifyInstance {
  // bodyLimit matches the nginx client_max_body_size so publish requests carrying
  // the full source tree are not rejected by the 1MB Fastify default.
  const app = Fastify({ logger: false, bodyLimit: 200 * 1024 * 1024 });
  const db = initDatabase(options.dbPath);
  if (options.autoSeed) {
    seedDevelopmentData(options.dbPath);
  }
  const repository = new SkillRepository(db);
  const adminRepository = new AdminRepository(db);
  const orgApplicationRepository = new OrgApplicationRepository(db);
  const platformSettingsRepository = new PlatformSettingsRepository(db);
  const operationRepository = new OperationRepository(db);
  const operationSecretRepository = new OperationSecretRepository(db);
  const operationAuditRepository = new OperationAuditRepository(db);
  const tenantOrganizationRepository = new TenantOrganizationRepository(db);
  const operationEventBus = options.operationEventBus ?? new OperationEventBus();
  const operationExecutor = new OperationExecutor(operationRepository, undefined, undefined, (operation) => {
    operationEventBus.publish(operation);
  });
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

  // 声明了默认组织的部署在监听前完成开通,失败则启动失败(见 ADR-0022)。
  const declaredOrgBootstrap = options.declaredOrgBootstrap;
  if (declaredOrgBootstrap) {
    app.addHook('onReady', async () => {
      await ensureDeclaredOrgBootstrap({
        giteaService: options.giteaService,
        platformSettingsRepository,
        tenantOrganizationRepository,
        orgName: declaredOrgBootstrap.orgName,
        adminPassword: declaredOrgBootstrap.adminPassword,
        deploymentMode: declaredOrgBootstrap.deploymentMode
      });
    });
  }

  app.get('/health', async () => ({ ok: true, service: 'esl-api' }));
  // 匿名平台信息(ADR-0022):CLI 与 Web 登录/注册页在登录前消费它自适应交互,
  // 默认组织对匿名可见是接受的成本(企业内网部署场景无碍)。
  app.get('/api/public/platform-info', async () => readPlatformInfo(platformSettingsRepository));
  app.get('/api/operations/:id', async (request, reply) => {
    // 供调用方查询跨系统 Operation 状态(错误信息已脱敏)。
    // 归属约束:携带发起者标识的操作仅发起者可查,其余仅平台管理员可查。
    const { username: requester, isPlatformAdmin: platformAdmin } = await resolveOperationRequester(
      request,
      adminRepository,
      options.giteaService
    );
    if (!requester) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) {
      return reply.status(404).send({ error: 'Operation not found' });
    }
    const operation = operationRepository.getOperation(id);
    if (!operation) {
      return reply.status(404).send({ error: 'Operation not found' });
    }
    const payload = operation.payload as { username?: string } | null;
    const ownerUsername = typeof payload?.username === 'string' ? payload.username : null;
    if (!platformAdmin && ownerUsername !== requester) {
      return reply.status(403).send({ error: 'Forbidden: operation owner or platform administrator required' });
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

  // Operation 状态流(SSE):前端提交跨系统操作后订阅其完成/失败通知,无需轮询。
  // 鉴权与查询端点一致(token 发起者或平台管理员);organization.provision 额外允许
  // 申请人凭初始密码订阅自己的开通流(与 POST /api/orgs/applications/:orgName/status 同源)。
  app.get('/api/operations/:id/stream', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) {
      return reply.status(404).send({ error: 'Operation not found' });
    }
    const operation = operationRepository.getOperation(id);
    if (!operation) {
      return reply.status(404).send({ error: 'Operation not found' });
    }
    const payload = operation.payload as { username?: string; orgName?: string; applicationId?: number } | null;
    const ownerUsername = typeof payload?.username === 'string' ? payload.username : null;

    const { username: requester, isPlatformAdmin: platformAdmin } = await resolveOperationRequester(
      request,
      adminRepository,
      options.giteaService
    );
    const operationOrgName = typeof payload?.orgName === 'string' ? payload.orgName : null;
    let authorized = Boolean(requester) && (platformAdmin || ownerUsername === requester);
    // 组织管理员可订阅本组织内操作的进度(成员创建/禁用/改密等 Operation
    // payload 带 orgName;目标用户是成员而非发起者,故额外放行组织管理员)。
    if (!authorized && operationOrgName && requester === `${operationOrgName}_admin`) {
      authorized = true;
    }
    if (!authorized && operation.kind === 'organization.provision') {
      const orgName = operationOrgName;
      const applicationId = typeof payload?.applicationId === 'number' ? payload.applicationId : null;
      const orgPassword = request.headers['x-org-password'];
      if (orgName && applicationId && typeof orgPassword === 'string' && options.applicationEncryptionKey) {
        const application = orgApplicationRepository.getApplicationById(applicationId);
        if (application?.encryptedPassword) {
          try {
            const expected = decryptApplicationSecret(application.encryptedPassword, options.applicationEncryptionKey);
            authorized = expected === orgPassword;
          } catch {
            authorized = false;
          }
        }
      }
    }
    if (!authorized) {
      return reply.status(403).send({ error: 'Forbidden: operation owner or platform administrator required' });
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // 让 nginx 对该响应关闭缓冲,SSE 事件即时到达客户端
      'X-Accel-Buffering': 'no'
    });

    const send = (op: OperationRecord): void => {
      if (!raw.destroyed) {
        raw.write(`data: ${JSON.stringify({ operationId: op.id, status: op.status, error: op.error ?? null })}\n\n`);
      }
    };
    // 订阅前先推送当前状态,让连接方立即拿到进度;之后由执行器 settle 时增量推送。
    send(operation);
    const unsubscribe = operationEventBus.subscribe(operation.id, send);
    // 心跳低于 nginx proxy_read_timeout(默认 60s),避免空闲连接被反代断开。
    const heartbeat = setInterval(() => {
      if (raw.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      raw.write(': ping\n\n');
    }, 15_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.addHook('preHandler', async (request, reply) => {
    const routePath = request.url.split('?')[0];
    // 单组织模式门禁(ADR-0022):仅默认组织成员与平台管理员可访问。冻结组织的存量
    // token 逐请求失效(立即拒绝,不等自然过期);新登录由下方登录门禁覆盖。
    // 组织实体状态不变——「不可登录」由平台模式推导,不新增组织级禁用状态。
    if (readDeploymentMode(platformSettingsRepository) === 'single') {
      const defaultOrg = readDefaultOrg(platformSettingsRepository);
      const authorization = request.headers.authorization;
      if (authorization?.startsWith('token ')) {
        const token = authorization.replace('token ', '').trim();
        const { username } = await resolveAuthedUser(token, adminRepository, options.giteaService);
        if (username) {
          const isAdmin = username === options.giteaService.adminUsername;
          const org = resolveUsernameOrg(username);
          if (!isAdmin && (org === null || org !== defaultOrg)) {
            return reply.status(403).send({ error: 'Organization is frozen in single-organization mode' });
          }
        }
      }
    }
    if (routePath === '/api/skills' || routePath.startsWith('/api/skills/')) {
      // 技能 Identity 形如 @scope/skill-name,scope 段即租户组织名;
      // POST /api/skills 的 Identity 在请求体中而非 URL。Source Upload
      // (/api/skills/upload)的 body.name 是技能短名而非 Identity,其租户
      // 组织由路由按调用方账号解析并校验(ADR-0024),此处跳过短名误判。
      if (routePath === '/api/skills/upload') {
        return;
      }
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
    // CLI 与管理后台登录端点共用同一组织激活门禁:body 以 { org } 显式携带
    // 组织名,省略时按默认组织解析(ADR-0022)。平台管理员账号无组织,跳过。
    if (routePath === '/api/auth/login' || routePath === '/api/console/login') {
      const body = (request.body ?? {}) as { org?: string };
      const org = typeof body.org === 'string' && body.org ? body.org : readDefaultOrg(platformSettingsRepository);
      const tenant = org ? tenantOrganizationRepository.get(org) : undefined;
      if (tenant && tenant.status !== 'active') {
        return reply.status(409).send({
          error: `Organization is not active: ${org}`,
          status: tenant.status
        });
      }
      // 单组织模式下只有默认组织的成员可以登录(ADR-0022)。
      if (readDeploymentMode(platformSettingsRepository) === 'single' && org && org !== readDefaultOrg(platformSettingsRepository)) {
        return reply.status(403).send({ error: 'Organization is frozen in single-organization mode' });
      }
    }
  });

  registerAuthRoutes(app, {
    repository: adminRepository,
    giteaService: options.giteaService,
    platformSettingsRepository,
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
    tenantOrganizationRepository,
    packageRoot: options.packageRoot ?? path.join(path.dirname(options.dbPath), 'packages'),
    operationRepository,
    operationExecutor
  });
  app.addHook('onClose', () => db.close());

  return app;
}
