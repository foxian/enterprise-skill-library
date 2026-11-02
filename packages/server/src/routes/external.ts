import type { FastifyInstance } from 'fastify';
import type {
  AdminRepository,
  ExternalSourceRecord,
  SkillRepository,
  ExternalSourceRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import {
  canManageSkill,
  hasReadAccess
} from '../services/skill-access.js';
import { ExternalGitFetcher } from '../services/external-git-fetcher.js';
import {
  synchronizeExternalReference,
  type SyncDependencies
} from '../services/external-sync-service.js';
import {
  detectLicenseFromFiles,
  validateCalendarSchedule,
  type CalendarSchedule
} from '@esl/core';
import { computeNextCheck } from '../services/external-sync-service.js';
import { apiError } from '../errors.js';
import { logEvent } from '../logging.js';

export interface ExternalRouteOptions {
  repository: SkillRepository;
  externalSourceRepository: ExternalSourceRepository;
  adminRepository: AdminRepository;
  giteaService: GiteaService;
  tenantOrganizationRepository: TenantOrganizationRepository;
  fetcher: ExternalGitFetcher;
  packageRoot: string;
}

interface PreviewBody {
  repositoryUrl?: string;
  branch?: string;
  skillDirectory?: string;
  extraFiles?: string[];
}

interface CreateBody extends PreviewBody {
  scope?: string; // 目标 namespace；个人或组织名
  shortName?: string;
  visibility?: string;
  schedule?: unknown;
  confirmLicense?: boolean;
}

// 把存储记录整理为对外视图（不暴露内部列名/实现）。visibility 来自 skills 表。
function externalSourceView(record: ExternalSourceRecord, visibility?: string): Record<string, unknown> {
  return {
    skillName: record.skillName,
    repositoryUrl: record.repositoryUrl,
    skillDirectory: record.skillDirectory || '/',
    branch: record.branch,
    schedule: record.schedule,
    syncState: record.syncState,
    visibility: visibility === 'public' ? 'public' : 'private',
    locked: record.locked,
    lastSyncedCommit: record.lastSyncedCommit,
    lastSuccessfulAt: record.lastSuccessfulAt,
    lastCheckedAt: record.lastCheckedAt,
    nextCheckAt: record.nextCheckAt,
    currentError: record.currentError,
    errorCode: record.errorCode,
    license: {
      basis: record.licenseBasis,
      provenance: record.licenseProvenance,
      confirmedBy: record.licenseConfirmedBy,
      confirmedAt: record.licenseConfirmedAt
    },
    extraFiles: record.extraFiles,
    catchupDue: record.catchupDue
  };
}

export function registerExternalRoutes(app: FastifyInstance, options: ExternalRouteOptions): void {
  const {
    repository,
    externalSourceRepository,
    adminRepository,
    giteaService,
    tenantOrganizationRepository,
    fetcher
  } = options;

  const syncDeps = (): SyncDependencies => ({
    skillRepository: repository,
    externalSourceRepository,
    giteaService,
    fetcher,
    packageRoot: options.packageRoot
  });

  // 解析当前请求用户。
  async function currentUser(request: import('fastify').FastifyRequest): Promise<{ username: string } | null> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('token ')) return null;
    const token = authorization.replace('token ', '').trim();
    const eslUser = adminRepository.validateUserToken(token);
    if (eslUser) return eslUser;
    if (adminRepository.hasIssuedToken(token) || token.startsWith('esl_')) return null;
    return giteaService.validateToken(token);
  }

  // 创建前预览：解析默认分支、抓取内容、展示检测到的许可证及来源与候选文件。
  app.post('/api/external-references/preview', async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.status(401).send(apiError('unauthorizedMissingToken'));
    const body = request.body as PreviewBody;
    if (!body.repositoryUrl) {
      return reply.status(400).send(apiError('externalSourceInvalidUrl'));
    }

    let branch = body.branch?.trim();
    try {
      if (!branch) {
        branch = await fetcher.resolveDefaultBranch(body.repositoryUrl);
      }
      const fetched = await fetcher.fetch({
        repositoryUrl: body.repositoryUrl,
        branch,
        skillDirectory: body.skillDirectory?.trim() ?? '',
        extraFiles: body.extraFiles ?? []
      });
      const detected = detectLicenseFromFiles(fetched.files);
      return reply.send({
        branch,
        commit: fetched.commit,
        files: Object.keys(fetched.files).sort(),
        detectedLicense: detected.license ?? null,
        licenseProvenance: detected.provenance ?? null
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'externalSourceFetchFailed';
      const clientErrors = new Set([
        'externalSourceHttpsRequired',
        'externalSourceCredentialsForbidden',
        'externalSourceInvalidUrl',
        'externalSourceForbiddenAddress'
      ]);
      logEvent(request.log, 'warn', { event: 'external.preview', errorCode: code }, 'External preview failed');
      return reply.status(clientErrors.has(code) ? 400 : 502).send(apiError(code as never));
    }
  });

  // 创建外部引用：校验 namespace 权限、查重、落 skill + 外部配置。
  app.post('/api/external-references', async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.status(401).send(apiError('unauthorizedMissingToken'));
    const body = request.body as CreateBody;
    const namespace = body.scope?.replace(/^@/, '').trim();
    const shortName = body.shortName?.trim();
    if (!namespace || !shortName || !body.repositoryUrl) {
      return reply.status(400).send(apiError('externalSourceInvalidUrl'));
    }
    if (!/^[a-z0-9-]{1,64}$/.test(shortName)) {
      return reply.status(400).send(apiError('externalSourceInvalidUrl'));
    }

    const fullName = `@${namespace}/${shortName}`;
    if (repository.getSkill(fullName)) {
      return reply.status(409).send(apiError('skillNameAlreadyExists'));
    }

    // 归属权限：个人 namespace 只能是自己；组织 namespace 需是其成员。
    if (namespace !== user.username) {
      const tenant = tenantOrganizationRepository.get(namespace);
      if (!tenant || tenant.status !== 'active') {
        return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
      }
      const members = await giteaService.listOrgMembers(namespace);
      if (!members.some((member: { username?: string } | string) =>
        typeof member === 'string' ? member === user.username : member.username === user.username)) {
        return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
      }
    }

    // 计划校验（默认每天 09:00 UTC）。
    const scheduleValidation = validateCalendarSchedule(
      body.schedule ?? { frequency: 'daily', time: '09:00', timeZone: 'UTC' }
    );
    if (!scheduleValidation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: scheduleValidation.errors.join(', ') }));
    }

    // 解析并锁定具体分支名。
    let branch = body.branch?.trim();
    if (!branch) {
      try {
        branch = await fetcher.resolveDefaultBranch(body.repositoryUrl);
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'externalSourceDefaultBranch';
        return reply.status(502).send(apiError(code as never));
      }
    }

    const visibility = body.visibility === 'public' ? 'public' : 'private';

    // 落技能身份与外部配置。初始抓取的成败不影响记录存在——失败引用可修正/移除。
    repository.createServerSkill({
      name: fullName,
      scope: namespace,
      skillName: shortName,
      description: '',
      createdBy: user.username,
      owner: user.username,
      maintainers: [],
      visibility,
      status: 'active-unreleased',
      gitRepoPath: `${namespace}/${shortName}`
    });
    externalSourceRepository.create({
      skillName: fullName,
      repositoryUrl: body.repositoryUrl,
      skillDirectory: body.skillDirectory?.trim() ?? '',
      branch,
      schedule: scheduleValidation.data,
      licenseConfirmedBy: body.confirmLicense ? user.username : undefined
    });
    if (body.extraFiles) {
      externalSourceRepository.updateExtraFiles(fullName, body.extraFiles);
    }

    // 创建后立即尝试一次同步：成功且已确认许可证 → 0.1.0；否则保留可修正记录。
    let sync;
    try {
      sync = await synchronizeExternalReference(syncDeps(), fullName, user);
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'externalSourceSyncFailed';
      sync = { outcome: 'failed' as const, errorCode: code };
      // 保证引用有下次检查时间，失败记录仍会被日历调度重试（ADR-0074）。
      const record = externalSourceRepository.get(fullName);
      if (record) {
        externalSourceRepository.recordFailure({
          skillName: fullName,
          error: (error as Error).message || 'Synchronization failed',
          errorCode: code,
          nextCheckAt: computeNextCheck(record.schedule as CalendarSchedule)
        });
      }
    }

    return reply.status(201).send({
      ...externalSourceView(externalSourceRepository.get(fullName)!, repository.getSkill(fullName)?.visibility),
      initialSync: sync
    });
  });

  // 详情：需有读权限（私有引用无权用户不可见）。
  app.get('/api/external-references/:scope/:skillName', async (request, reply) => {
    const user = await currentUser(request);
    const params = request.params as { scope: string; skillName: string };
    const fullName = `@${params.scope.replace(/^@/, '')}/${params.skillName}`;
    const record = externalSourceRepository.get(fullName);
    const skill = repository.getSkill(fullName);
    if (!record || !skill) return reply.status(404).send(apiError('externalSourceNotFound'));
    if (!user || !(await hasReadAccess(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    return reply.send(externalSourceView(record, skill.visibility));
  });

  // 更新配置：分支/计划/可见性/目录外文件。锁定后来源不可改，计划与可见性可改。
  app.patch('/api/external-references/:scope/:skillName', async (request, reply) => {
    const user = await currentUser(request);
    const params = request.params as { scope: string; skillName: string };
    const fullName = `@${params.scope.replace(/^@/, '')}/${params.skillName}`;
    const record = externalSourceRepository.get(fullName);
    const skill = repository.getSkill(fullName);
    if (!record || !skill) return reply.status(404).send(apiError('externalSourceNotFound'));
    if (!user || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }

    const body = request.body as {
      repositoryUrl?: string;
      skillDirectory?: string;
      branch?: string;
      schedule?: unknown;
      visibility?: string;
      extraFiles?: string[];
    };

    // 首次成功发布前允许修正填错的来源（URL/目录/分支）；锁定后拒绝（ADR-0074）。
    const wantsSourceChange = Boolean(
      body.repositoryUrl !== undefined || body.skillDirectory !== undefined || body.branch?.trim()
    );
    if (wantsSourceChange && record.locked) {
      return reply.status(409).send(apiError('externalSourceLocked'));
    }

    if (body.schedule) {
      const validation = validateCalendarSchedule(body.schedule);
      if (!validation.success) {
        return reply.status(400).send(apiError('validationFailed', { detail: validation.errors.join(', ') }));
      }
      externalSourceRepository.updateSchedule(fullName, validation.data as CalendarSchedule);
    }

    if (wantsSourceChange) {
      externalSourceRepository.updateSourceBeforeLock({
        skillName: fullName,
        repositoryUrl: body.repositoryUrl?.trim() || undefined,
        skillDirectory: body.skillDirectory?.trim(),
        branch: body.branch?.trim() || undefined
      });
    }

    if (body.visibility === 'public' || body.visibility === 'private') {
      // 扩大公开范围（private → public）要求重新确认许可证。
      const broadening = skill.visibility === 'private' && body.visibility === 'public';
      if (broadening && !(record.licenseConfirmedAt)) {
        return reply.status(409).send(apiError('externalSourceLicenseConfirmationRequired'));
      }
      repository.setVisibility(fullName, body.visibility);
    }

    if (Array.isArray(body.extraFiles) && !record.locked) {
      externalSourceRepository.updateExtraFiles(fullName, body.extraFiles);
    }

    return reply.send(externalSourceView(externalSourceRepository.get(fullName)!, repository.getSkill(fullName)?.visibility));
  });

  // 立即同步。
  app.post('/api/external-references/:scope/:skillName/sync', async (request, reply) => {
    const user = await currentUser(request);
    const params = request.params as { scope: string; skillName: string };
    const fullName = `@${params.scope.replace(/^@/, '')}/${params.skillName}`;
    const record = externalSourceRepository.get(fullName);
    const skill = repository.getSkill(fullName);
    if (!record || !skill) return reply.status(404).send(apiError('externalSourceNotFound'));
    if (!user || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    // 暂停引用：认领（claim）会把状态改成 syncing 从而绕过同步函数内的暂停守卫，
    // 因此在这里先拦截，返回 409。
    if (record.syncState === 'paused') {
      return reply.status(409).send(apiError('externalSourcePaused'));
    }
    // 幂等闸门：已在同步中则不重复执行。
    if (!externalSourceRepository.claimForSync(fullName)) {
      return reply.send({ outcome: 'syncing', skillName: fullName });
    }
    try {
      const result = await synchronizeExternalReference(syncDeps(), fullName, user);
      return reply.send(result);
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'externalSourceSyncFailed';
      // 可预期失败（归档/不存在）不会在同步服务内落状态；必须解除认领，避免引用
      // 永久停留在 syncing 而不再被调度。
      externalSourceRepository.markIdle(fullName);
      const status = code === 'externalSourceNotFound' ? 404
        : code === 'externalSourceArchived' ? 409
        : 500;
      return reply.status(status).send(apiError(code as never));
    }
  });

  // 暂停。
  app.post('/api/external-references/:scope/:skillName/pause', async (request, reply) => {
    const user = await currentUser(request);
    const params = request.params as { scope: string; skillName: string };
    const fullName = `@${params.scope.replace(/^@/, '')}/${params.skillName}`;
    const skill = repository.getSkill(fullName);
    if (!skill) return reply.status(404).send(apiError('externalSourceNotFound'));
    if (!user || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    externalSourceRepository.markPaused(fullName);
    return reply.send(externalSourceView(externalSourceRepository.get(fullName)!, repository.getSkill(fullName)?.visibility));
  });

  // 恢复：标记补跑一次，再回到计划。
  app.post('/api/external-references/:scope/:skillName/resume', async (request, reply) => {
    const user = await currentUser(request);
    const params = request.params as { scope: string; skillName: string };
    const fullName = `@${params.scope.replace(/^@/, '')}/${params.skillName}`;
    const skill = repository.getSkill(fullName);
    if (!skill) return reply.status(404).send(apiError('externalSourceNotFound'));
    if (!user || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    // 恢复后最多补一次最近遗漏检查。
    externalSourceRepository.setCatchupDue(fullName, true);
    externalSourceRepository.markIdle(fullName);
    return reply.send(externalSourceView(externalSourceRepository.get(fullName)!, repository.getSkill(fullName)?.visibility));
  });

  // 确认许可证。
  app.post('/api/external-references/:scope/:skillName/license', async (request, reply) => {
    const user = await currentUser(request);
    const params = request.params as { scope: string; skillName: string };
    const fullName = `@${params.scope.replace(/^@/, '')}/${params.skillName}`;
    const skill = repository.getSkill(fullName);
    if (!skill) return reply.status(404).send(apiError('externalSourceNotFound'));
    if (!user || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    const body = request.body as { basis?: string; extraFiles?: string[] };
    if (!body.basis?.trim()) return reply.status(400).send(apiError('externalSourceLicenseConfirmationRequired'));
    if (Array.isArray(body.extraFiles)) {
      externalSourceRepository.updateExtraFiles(fullName, body.extraFiles);
    }
    externalSourceRepository.confirmLicense({
      skillName: fullName,
      basis: body.basis.trim(),
      confirmedBy: user.username
    });
    return reply.send(externalSourceView(externalSourceRepository.get(fullName)!, repository.getSkill(fullName)?.visibility));
  });
}
