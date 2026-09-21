import { apiError } from './errors.js';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions
} from 'fastify';
import {
  AdminRepository,
  initDatabase,
  OrgApplicationRepository,
  PlatformSettingsRepository,
  SkillRepository,
  SkillTeamGrantRepository,
  TenantOrganizationRepository
} from './db/database.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerOrgRoutes } from './routes/orgs.js';
import { registerOrgAdminRoutes } from './routes/org-admin.js';
import { registerUserAdminRoutes } from './routes/user-admin.js';
import { registerOrgConsoleRoutes } from './routes/org-console.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { GiteaRequestError, type GiteaService } from './services/gitea.js';
import path from 'node:path';
import { registerUserRoutes } from './routes/register.js';
import { OrgInvitationRepository, UserRegistrationRepository } from './db/database.js';
import { seedDevelopmentAccounts, seedDevelopmentData } from './seed.js';
import { readPlatformInfo } from './services/platform-config.js';
import { logEvent, logTaskFinished, logTaskStarted, taskLogger } from './logging.js';
import { STATUS_CODES } from 'node:http';

export interface AppOptions {
  dbPath: string;
  packageRoot?: string;
  giteaService: GiteaService;
  repoOwner: string;
  passwordMinLength?: number;
  // When true, sample skill metadata is seeded into the database at startup
  // (ESL_AUTO_SEED). Seeding is idempotent and only inserts development data.
  autoSeed?: boolean;
  // 诊断日志出口（ADR-0045）。生产传 createLogger() 的结果；测试注入可捕获的
  // logger；不传则完全关闭，普通测试输出不被生产日志污染。
  logger?: FastifyServerOptions['logger'];
}

const PENDING_APPLICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 5xx 响应体保持 Fastify 既有形状（statusCode / 可选 code / error / message）。
// 我们接管了错误边界，就必须自己复刻这个序列化结果，否则日志改造会顺手改掉
// API 响应契约（US58）。
interface ErrorLike {
  status?: number;
  statusCode?: number;
  code?: unknown;
  message: string;
  headers?: Record<string, string>;
}

function resolveErrorStatus(error: ErrorLike): number {
  // 与 Fastify 的 setErrorHeaders 同序：status 优先于 statusCode。
  const raw = error.status ?? error.statusCode ?? 500;
  return Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
}

function defaultErrorPayload(status: number, error: ErrorLike): Record<string, unknown> {
  const payload: Record<string, unknown> = { statusCode: status };
  if (typeof error.code === 'string') {
    payload.code = error.code;
  }
  payload.error = STATUS_CODES[String(status)] ?? 'Error';
  payload.message = error.message;
  return payload;
}

// 统一的 token → 调用方身份解析:token 可来自平台管理员、Skill User 或 Gitea
// 用户,DB 内先查(已登记 token,无网络往返)再回退 Gitea。
// 组织冻结判断与路由鉴权共用此实现,保持一致。
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
  // 需按 Gitea 管理员身份补齐判定。
  const isAdminByGitea = username !== null && username === giteaService.adminUsername;
  return { username, isPlatformAdmin: Boolean(platformAdmin) || isAdminByGitea };
}

export function buildApp(options: AppOptions): FastifyInstance {
  // bodyLimit matches the nginx client_max_body_size so publish requests carrying
  // the full source tree are not rejected by the 1MB Fastify default.
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 200 * 1024 * 1024 });
  const db = initDatabase(options.dbPath, app.log);
  if (options.autoSeed) {
    seedDevelopmentData(options.dbPath);
    // 开发环境同时产出全局账号与示例组织（ADR-0032）；尽力而为，不阻塞启动。
    // 它是独立系统任务（不挂在任何请求上），用应用级子 logger 并记录完整的
    // started / succeeded / failed 生命周期（US39/US40）。
    const seedTaskId = 'seed-development-accounts';
    const seedLogger = taskLogger(app.log, seedTaskId);
    logTaskStarted(seedLogger, seedTaskId, 'Seeding development accounts');
    void seedDevelopmentAccounts(options.giteaService, new TenantOrganizationRepository(db))
      .then(() => logTaskFinished(seedLogger, seedTaskId))
      .catch((error: unknown) => logTaskFinished(seedLogger, seedTaskId, error));
  }
  const repository = new SkillRepository(db);
  const adminRepository = new AdminRepository(db);
  const orgApplicationRepository = new OrgApplicationRepository(db);
  const platformSettingsRepository = new PlatformSettingsRepository(db);
  const tenantOrganizationRepository = new TenantOrganizationRepository(db);
  const skillTeamGrantRepository = new SkillTeamGrantRepository(db);
  expireStalePendingApplications();

  // 待审组织申请默认保留 30 天：过期即释放名字（ADR-0032）。
  function expireStalePendingApplications(): void {
    const cutoff = new Date(Date.now() - PENDING_APPLICATION_TTL_MS).toISOString();
    for (const application of orgApplicationRepository.expireStalePending(cutoff)) {
      // 过期没有外部副作用：状态翻转即释放名字（ADR-0032）。
      tenantOrganizationRepository.transition(application.orgName, 'expired');
    }
  }

  // Git Backend 错误统一映射（ADR-0032）：重名/占用类冲突如实回 409（调用方
  // 需要当场换名），其余上游故障回 502——不把基础设施问题伪装成客户端 500。
  // 非 Gitea 错误交回 Fastify 默认序列化，保持既有端点契约不变。
  app.setErrorHandler((error, request, reply) => {
    const errorLike = error as unknown as ErrorLike;
    const status =
      error instanceof GiteaRequestError
        ? error.status === 409 || error.status === 422
          ? 409
          : 502
        : resolveErrorStatus(errorLike);

    // 5xx 由这里统一记录并自己回响应：把响应交回 reply.send(error) 会让 Fastify
    // 的默认处理器再记一条（msg 还是异常原文），既重复又违反固定英文 msg 契约
    // （US12/US13/US21/US24）。
    if (status >= 500) {
      logEvent(
        request.log,
        'error',
        {
          event: 'request.failed',
          outcome: 'failed',
          method: request.method,
          statusCode: status,
          // 响应体用的稳定代码；基础设施异常没有更细的对外代码，统一归到
          // internalError，使日志与 API Error Code 可关联（US23）。
          errorCode: 'internalError',
          err: error
        },
        'Request failed'
      );
      if (error instanceof GiteaRequestError) {
        return reply.status(status).send(apiError('internalError', { detail: error.message }));
      }
      if (errorLike.headers) {
        reply.headers(errorLike.headers);
      }
      return reply.status(status).send(defaultErrorPayload(status, errorLike));
    }

    // 普通 4xx 交给请求完成日志表达，不升级成服务端异常（US10）。
    if (error instanceof GiteaRequestError) {
      return reply.status(409).send(apiError('internalError', { detail: error.message }));
    }
    return reply.send(error);
  });

  // 健康检查由 Docker/nginx 高频轮询，静默以免淹没真正有诊断价值的日志（ADR-0045）。
  app.get('/health', { logLevel: 'silent' }, async () => ({ ok: true, service: 'esl-api' }));
  // 匿名平台信息(ADR-0032):CLI 与 Web 登录/注册页在登录前消费它自适应交互
  // (注册模式与拉人方式)。
  app.get('/api/public/platform-info', async () => readPlatformInfo(platformSettingsRepository));
  app.addHook('preHandler', async (request, reply) => {
    const routePath = request.url.split('?')[0];
    if (routePath === '/api/skills' || routePath.startsWith('/api/skills/')) {
      // 技能 Identity 形如 @scope/skill-name,scope 段即命名空间;
      // 冻结/删除中的组织技能由门禁拦截。Source Upload (/api/skills/upload)
      // 的 body.name 是 release.json 的完整 name,由上传路由自行校验组织成员
      // 身份与状态,此处跳过。
      if (routePath === '/api/skills/upload') {
        return;
      }
      const urlSegment = decodeURIComponent(routePath.split('/')[3] ?? '');
      const bodyName = (request.body as { name?: string } | undefined)?.name ?? '';
      const scope = (urlSegment || bodyName).replace(/^@/, '').split('/')[0];
      const tenant = tenantOrganizationRepository.get(scope);
      if (tenant && tenant.status !== 'active') {
        // 平台管理员保留治理可见性(ADR-0025):冻结/删除中的组织技能仍可巡检,
        // 不受组织激活门禁限制;其余调用方一律拒绝。
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith('token ') ? authorization.replace('token ', '').trim() : '';
        const { isPlatformAdmin } = token
          ? await resolveAuthedUser(token, adminRepository, options.giteaService)
          : { isPlatformAdmin: false };
        if (!isPlatformAdmin) {
          return reply.status(409).send({
            ...apiError('organizationIsNotActive', { org: scope }),
            status: tenant.status
          });
        }
      }
    }
    // 全局身份登录（ADR-0032）：登录请求不再携带组织字段，组织激活门禁
    // 由此处移除；单组织模式与冻结组织的存量 token 门禁保留在上方。
  });

  registerAuthRoutes(app, {
    repository: adminRepository,
    giteaService: options.giteaService,
    platformSettingsRepository,
    userRegistrationRepository: new UserRegistrationRepository(db),
    passwordMinLength: options.passwordMinLength
  });
  registerUserRoutes(app, {
    giteaService: options.giteaService,
    platformSettingsRepository,
    userRegistrationRepository: new UserRegistrationRepository(db),
    orgApplicationRepository,
    passwordMinLength: options.passwordMinLength
  });
  registerOrgRoutes(app, {
    giteaService: options.giteaService,
    orgApplicationRepository,
    platformSettingsRepository,
    tenantOrganizationRepository
  });
  registerOrgAdminRoutes(app, {
    giteaService: options.giteaService,
    orgApplicationRepository,
    platformSettingsRepository,
    skillRepository: repository,
    tenantOrganizationRepository,
    userRegistrationRepository: new UserRegistrationRepository(db)
  });
  registerUserAdminRoutes(app, {
    adminRepository,
    giteaService: options.giteaService,
    orgApplicationRepository,
    platformSettingsRepository,
    userRegistrationRepository: new UserRegistrationRepository(db),
    passwordMinLength: options.passwordMinLength
  });
  registerOrgConsoleRoutes(app, {
    giteaService: options.giteaService,
    repository,
    platformSettingsRepository,
    orgInvitationRepository: new OrgInvitationRepository(db),
    tenantOrganizationRepository,
    skillTeamGrantRepository
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
    skillTeamGrantRepository,
    packageRoot: options.packageRoot ?? path.join(path.dirname(options.dbPath), 'packages')
  });
  app.addHook('onClose', () => db.close());

  return app;
}
