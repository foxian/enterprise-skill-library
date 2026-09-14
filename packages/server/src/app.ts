import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  AdminRepository,
  initDatabase,
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
import { runOrganizationDeletion } from './services/org-delete.js';
import { registerUserRoutes } from './routes/register.js';
import { OrgInvitationRepository, UserRegistrationRepository } from './db/database.js';
import { seedDevelopmentAccounts, seedDevelopmentData } from './seed.js';
import { readPlatformInfo } from './services/platform-config.js';

export interface AppOptions {
  dbPath: string;
  packageRoot?: string;
  giteaService: GiteaService;
  repoOwner: string;
  passwordMinLength?: number;
  // When true, sample skill metadata is seeded into the database at startup
  // (ESL_AUTO_SEED). Seeding is idempotent and only inserts development data.
  autoSeed?: boolean;
}

const PENDING_APPLICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  const app = Fastify({ logger: false, bodyLimit: 200 * 1024 * 1024 });
  const db = initDatabase(options.dbPath);
  if (options.autoSeed) {
    seedDevelopmentData(options.dbPath);
    // 开发环境同时产出全局账号（ADR-0032）；尽力而为，不阻塞启动。
    void seedDevelopmentAccounts(options.giteaService).catch(() => {});
  }
  const repository = new SkillRepository(db);
  const adminRepository = new AdminRepository(db);
  const orgApplicationRepository = new OrgApplicationRepository(db);
  const platformSettingsRepository = new PlatformSettingsRepository(db);
  const tenantOrganizationRepository = new TenantOrganizationRepository(db);
  expireStalePendingApplications();

  // 待审组织申请默认保留 30 天：过期即释放名字（ADR-0032）。
  function expireStalePendingApplications(): void {
    const cutoff = new Date(Date.now() - PENDING_APPLICATION_TTL_MS).toISOString();
    for (const application of orgApplicationRepository.expireStalePending(cutoff)) {
      // 过期没有外部副作用：状态翻转即释放名字（ADR-0032）。
      tenantOrganizationRepository.transition(application.orgName, 'expired');
    }
  }

  app.get('/health', async () => ({ ok: true, service: 'esl-api' }));
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
            error: `Organization is not active: ${scope}`,
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
  registerOrgConsoleRoutes(app, {
    giteaService: options.giteaService,
    repository,
    platformSettingsRepository,
    orgInvitationRepository: new OrgInvitationRepository(db),
    tenantOrganizationRepository
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
    packageRoot: options.packageRoot ?? path.join(path.dirname(options.dbPath), 'packages')
  });
  app.addHook('onClose', () => db.close());

  return app;
}
