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
import { ExternalGitFetcher, type LicenseCandidateFile } from '../services/external-git-fetcher.js';
import {
  synchronizeExternalReference,
  type SyncDependencies
} from '../services/external-sync-service.js';
import {
  detectLicenseFromCandidates,
  detectLicenseFromFiles,
  validateCalendarSchedule,
  validateSkillMd,
  type ByteFileMap,
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
  scope?: string;
}

interface CreateBody extends PreviewBody {
  visibility?: string;
  schedule?: unknown;
  confirmLicense?: boolean;
}

interface FetchedSource {
  files: ByteFileMap;
  licenseCandidates?: LicenseCandidateFile[];
}

// 优先使用技能目录及祖先目录的候选文件识别许可证；未启用候选收集时回退到已抓取文件。
function detectLicenseFor(fetched: FetchedSource) {
  return fetched.licenseCandidates && fetched.licenseCandidates.length > 0
    ? detectLicenseFromCandidates(fetched.licenseCandidates)
    : detectLicenseFromFiles(fetched.files);
}

// 上游内容必须是可校验的技能：有 SKILL.md 且 frontmatter 含合法名称与描述。
type UpstreamMetadataResult =
  | { error: 'externalSourceMissingSkillMd' | 'externalSourceInvalidSkillMd' }
  | { metadata: { name: string; description: string } };

function readUpstreamMetadata(fetched: FetchedSource): UpstreamMetadataResult {
  const skillMd = fetched.files['SKILL.md'];
  if (!skillMd) return { error: 'externalSourceMissingSkillMd' };
  const metadata = validateSkillMd(skillMd.toString('utf8'));
  if (!metadata.success) return { error: 'externalSourceInvalidSkillMd' };
  return { metadata: metadata.data };
}

// 把存储记录整理为对外视图（不暴露内部列名/实现）。可见性与描述来自 skills 表。
function externalSourceView(
  record: ExternalSourceRecord,
  skill?: { visibility?: string; description?: string },
  latestVersion?: string
): Record<string, unknown> {
  return {
    skillName: record.skillName,
    description: skill?.description ?? '',
    latestVersion: latestVersion ?? null,
    repositoryUrl: record.repositoryUrl,
    skillDirectory: record.skillDirectory || '/',
    branch: record.branch,
    schedule: record.schedule,
    syncState: record.syncState,
    visibility: skill?.visibility === 'public' ? 'public' : 'private',
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

// 抓取类错误里，属于请求本身不合法（地址、分支、目录、许可文件）的返回 400，
// 其余视为上游不可用返回 502。
const CLIENT_SOURCE_ERROR_CODES = new Set([
  'externalSourceHttpsRequired',
  'externalSourceCredentialsForbidden',
  'externalSourceInvalidUrl',
  'externalSourceForbiddenAddress',
  'externalSourceBranchNotFound',
  'externalSourceDirectoryNotFound',
  'externalSourceExtraFileNotFound',
  'externalSourcePathTraversal'
]);

function sourceErrorStatus(code: string): number {
  return CLIENT_SOURCE_ERROR_CODES.has(code) ? 400 : 502;
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

  // 创建/编辑来源前预览：解析默认分支、抓取内容、读取技能名称与描述，并展示
  // 技能目录及祖先目录中的许可候选文件与识别结果（ADR-0075）。
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
        extraFiles: body.extraFiles ?? [],
        includeLicenseCandidates: true
      });
      const upstream = readUpstreamMetadata(fetched);
      if ('error' in upstream) {
        return reply.status(400).send(apiError(upstream.error));
      }
      const detected = detectLicenseFor(fetched);
      const scope = body.scope?.replace(/^@/, '').trim();
      const existing = scope
        ? repository.getSkill(`@${scope}/${upstream.metadata.name}`)
        : undefined;
      return reply.send({
        branch,
        commit: fetched.commit,
        files: Object.keys(fetched.files).sort(),
        skillName: upstream.metadata.name,
        description: upstream.metadata.description,
        detectedLicense: detected.license ?? null,
        licenseProvenance: detected.provenance ?? null,
        licenseCandidates: fetched.licenseCandidates ?? [],
        nameConflict: Boolean(existing),
        existingExternal: existing ? Boolean(externalSourceRepository.get(existing.name)) : false
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'externalSourceFetchFailed';
      logEvent(request.log, 'warn', { event: 'external.preview', errorCode: code }, 'External preview failed');
      return reply.status(sourceErrorStatus(code)).send(apiError(code as never));
    }
  });

  // 创建外部引用：校验 namespace 权限、读取上游名称、查重、落 skill + 外部配置。
  // 技能名称不再由用户手填，而是从上游 SKILL.md 自动读取（ADR-0075）。
  app.post('/api/external-references', async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.status(401).send(apiError('unauthorizedMissingToken'));
    const body = request.body as CreateBody;
    const namespace = body.scope?.replace(/^@/, '').trim();
    if (!namespace || !body.repositoryUrl) {
      return reply.status(400).send(apiError('externalSourceInvalidUrl'));
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

    // 抓取并校验上游技能，读取名称、描述与许可候选；名称冲突在此明确拒绝。
    let fetched: FetchedSource;
    try {
      fetched = await fetcher.fetch({
        repositoryUrl: body.repositoryUrl,
        branch,
        skillDirectory: body.skillDirectory?.trim() ?? '',
        extraFiles: body.extraFiles ?? [],
        includeLicenseCandidates: true
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'externalSourceFetchFailed';
      return reply.status(sourceErrorStatus(code)).send(apiError(code as never));
    }
    const upstream = readUpstreamMetadata(fetched);
    if ('error' in upstream) {
      return reply.status(400).send(apiError(upstream.error));
    }
    const shortName = upstream.metadata.name;
    const fullName = `@${namespace}/${shortName}`;
    if (repository.getSkill(fullName)) {
      return reply.status(409).send(apiError('skillNameAlreadyExists'));
    }

    const detected = detectLicenseFor(fetched);
    const visibility = body.visibility === 'public' ? 'public' : 'private';
    const confirmed = Boolean(body.confirmLicense && detected.license);

    // 落技能身份与外部配置。初始同步失败时记录仍可修正/移除。
    repository.createServerSkill({
      name: fullName,
      scope: namespace,
      skillName: shortName,
      description: upstream.metadata.description,
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
      licenseBasis: confirmed ? detected.license : undefined,
      licenseProvenance: detected.provenance,
      licenseConfirmedBy: confirmed ? user.username : undefined
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
      ...externalSourceView(
        externalSourceRepository.get(fullName)!,
        repository.getSkill(fullName),
        repository.getVersions(fullName)[0]
      ),
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
    return reply.send(
      externalSourceView(record, skill, repository.getVersions(fullName)[0])
    );
  });

  // 更新配置：计划、可见性、目录外文件，以及来源 URL。
  // 首次发布后目录与跟踪分支锁定，但仓库 URL 仍可由管理者修改（ADR-0075）。
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
      confirmLicense?: boolean;
    };

    const nextUrl = body.repositoryUrl?.trim();
    const urlChanged = Boolean(nextUrl && nextUrl !== record.repositoryUrl);
    const nextDirectory =
      body.skillDirectory !== undefined ? body.skillDirectory.trim() : record.skillDirectory;
    const directoryChanged = nextDirectory !== record.skillDirectory;
    const nextBranch = body.branch?.trim() || record.branch;
    const branchChanged = nextBranch !== record.branch;

    // 目录与跟踪分支在首次成功发布后锁定；URL 不受此限制。
    if (record.locked && (directoryChanged || branchChanged)) {
      return reply.status(409).send(apiError('externalSourceLocked'));
    }

    const sourceChanged = urlChanged || directoryChanged || branchChanged;

    // 先完成全部校验，再写入任何变更，避免失败时留下部分修改。
    let scheduleData: CalendarSchedule | undefined;
    if (body.schedule) {
      const validation = validateCalendarSchedule(body.schedule);
      if (!validation.success) {
        return reply.status(400).send(apiError('validationFailed', { detail: validation.errors.join(', ') }));
      }
      scheduleData = validation.data as CalendarSchedule;
    }

    // 任何来源位置变化都先验证新来源，验证失败保留原配置。
    let detectedLicense: string | undefined;
    let detectedProvenance: unknown;
    if (sourceChanged) {
      const nextExtraFiles = Array.isArray(body.extraFiles) ? body.extraFiles : record.extraFiles;
      let fetched: FetchedSource;
      try {
        fetched = await fetcher.fetch({
          repositoryUrl: nextUrl ?? record.repositoryUrl,
          branch: nextBranch,
          skillDirectory: nextDirectory,
          extraFiles: nextExtraFiles,
          includeLicenseCandidates: true
        });
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'externalSourceFetchFailed';
        logEvent(
          request.log,
          'warn',
          { event: 'external.source-update', errorCode: code },
          'External source update validation failed'
        );
        return reply.status(sourceErrorStatus(code)).send(apiError(code as never));
      }
      const upstream = readUpstreamMetadata(fetched);
      if ('error' in upstream) {
        return reply.status(400).send(apiError(upstream.error));
      }

      const detected = detectLicenseFor(fetched);
      detectedLicense = detected.license;
      detectedProvenance = detected.provenance;
      if (body.confirmLicense && !detectedLicense) {
        return reply.status(400).send(apiError('externalSourceLicenseConfirmationRequired'));
      }
    }

    if (body.visibility === 'public' || body.visibility === 'private') {
      // 扩大公开范围（private → public）要求重新确认许可证；来源变化会重置确认。
      const broadening = skill.visibility === 'private' && body.visibility === 'public';
      const willBeConfirmed = sourceChanged
        ? Boolean(body.confirmLicense && detectedLicense)
        : Boolean(record.licenseConfirmedAt);
      if (broadening && !willBeConfirmed) {
        return reply.status(409).send(apiError('externalSourceLicenseConfirmationRequired'));
      }
    }

    if (scheduleData) {
      externalSourceRepository.updateSchedule(fullName, scheduleData);
    }

    if (sourceChanged) {
      externalSourceRepository.updateSourceBeforeLock({
        skillName: fullName,
        repositoryUrl: urlChanged ? nextUrl : undefined,
        skillDirectory: directoryChanged ? nextDirectory : undefined,
        branch: branchChanged ? nextBranch : undefined
      });
      if (urlChanged) {
        externalSourceRepository.updateRepositoryUrl(fullName, nextUrl!);
        // 新来源已通过验证，旧来源的失败信息不再适用。
        externalSourceRepository.clearSyncError(fullName);
      }
      if (Array.isArray(body.extraFiles)) {
        externalSourceRepository.updateExtraFiles(fullName, body.extraFiles);
      }
      // 来源位置变化后不沿用旧许可确认，等待管理者核对新来源（ADR-0075）。
      externalSourceRepository.resetLicenseConfirmation({
        skillName: fullName,
        basis: detectedLicense ?? null,
        provenance: detectedProvenance
      });
      if (body.confirmLicense && detectedLicense) {
        externalSourceRepository.confirmLicense({
          skillName: fullName,
          basis: detectedLicense,
          provenance: detectedProvenance,
          confirmedBy: user.username
        });
      }
    } else if (Array.isArray(body.extraFiles) && !record.locked) {
      externalSourceRepository.updateExtraFiles(fullName, body.extraFiles);
    }

    if (body.visibility === 'public' || body.visibility === 'private') {
      repository.setVisibility(fullName, body.visibility);
    }

    return reply.send(
      externalSourceView(
        externalSourceRepository.get(fullName)!,
        repository.getSkill(fullName),
        repository.getVersions(fullName)[0]
      )
    );
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
    return reply.send(
      externalSourceView(
        externalSourceRepository.get(fullName)!,
        repository.getSkill(fullName),
        repository.getVersions(fullName)[0]
      )
    );
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
    return reply.send(
      externalSourceView(
        externalSourceRepository.get(fullName)!,
        repository.getSkill(fullName),
        repository.getVersions(fullName)[0]
      )
    );
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
    return reply.send(
      externalSourceView(
        externalSourceRepository.get(fullName)!,
        repository.getSkill(fullName),
        repository.getVersions(fullName)[0]
      )
    );
  });
}
