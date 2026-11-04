import fs from 'node:fs/promises';
import path from 'node:path';
import {
  computeContentFingerprint,
  detectLicenseFromFiles,
  mergeUpstreamMetadata,
  nextExternalVersion,
  resolveReleaseGraph,
  ReleaseGraphError,
  createPublishedSkillPackage,
  sha256Integrity,
  validateSkillMd,
  type ByteFileMap,
  type CalendarSchedule,
  nextScheduledCheck
} from '@esl/core';
import type {
  ExternalSourceRecord,
  ExternalSourceRepository,
  SkillRepository
} from '../db/database.js';
import { ServerReleaseGraphSource } from './release-graph-source.js';
import type { GiteaService } from './gitea.js';
import { ExternalGitFetcher } from './external-git-fetcher.js';

// 外部引用同步编排（ADR-0074）：定时与手动共用同一路径。只在选定范围内容变化时
// 通过既有发布链生成普通 Skill Release；失败保留最后成功版本，绝不产生半成品。

export type SyncOutcome =
  | 'published'
  | 'unchanged'
  | 'failed'
  | 'license-confirmation-required';

export interface SyncResult {
  outcome: SyncOutcome;
  skillName: string;
  version?: string;
  commit?: string;
  errorCode?: string;
  error?: string;
}

export interface SyncDependencies {
  skillRepository: SkillRepository;
  externalSourceRepository: ExternalSourceRepository;
  giteaService: GiteaService;
  fetcher: ExternalGitFetcher;
  packageRoot: string;
}

// 同步过程中的可预期错误：携带稳定错误码，便于落状态与映射 HTTP。
export class ExternalSyncError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'ExternalSyncError';
  }
}

function mapUnknownToSyncError(error: unknown): ExternalSyncError {
  if (error instanceof ExternalSyncError) return error;
  const code =
    (error as { code?: string }).code &&
    typeof (error as { code?: string }).code === 'string'
      ? ((error as { code: string }).code)
      : 'externalSourceSyncFailed';
  return new ExternalSyncError((error as Error).message || 'Synchronization failed', code);
}

// 为引用计算下次计划检查的 UTC ISO；paused/archived 时不安排。
export function computeNextCheck(schedule: CalendarSchedule, from: Date = new Date()): string {
  return nextScheduledCheck(schedule, from).toISOString();
}

// 执行一次同步。调用方（路由/调度器）应先确认非暂停、非归档；认领（claim）
// 已在 repository 层原子完成，这里只在认领成功后运行。
export async function synchronizeExternalReference(
  deps: SyncDependencies,
  skillName: string,
  actor: { username: string },
  options: { now?: Date } = {}
): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const source = deps.externalSourceRepository.get(skillName);
  const skill = deps.skillRepository.getSkill(skillName);
  if (!source || !skill) {
    throw new ExternalSyncError('External reference not found', 'externalSourceNotFound');
  }
  if (source.syncState === 'paused') {
    throw new ExternalSyncError('Synchronization is paused', 'externalSourcePaused');
  }
  if (skill.status === 'archived') {
    throw new ExternalSyncError('Skill is archived', 'externalSourceArchived');
  }

  // 1) 抓取上游（锁定分支、选定目录 + 已确认目录外文件）。
  let fetched: { commit: string; files: ByteFileMap };
  try {
    fetched = await deps.fetcher.fetch({
      repositoryUrl: source.repositoryUrl,
      branch: source.branch,
      skillDirectory: source.skillDirectory,
      extraFiles: source.extraFiles
    });
  } catch (error) {
    return failAndRecord(deps, source, mapUnknownToSyncError(error), now);
  }

  // 2) 必须含 SKILL.md 且可校验——上游数据是技能，不是任意目录。
  if (!fetched.files['SKILL.md']) {
    return failAndRecord(
      deps,
      source,
      new ExternalSyncError('Selected directory has no SKILL.md', 'externalSourceMissingSkillMd'),
      now
    );
  }
  const skillMdValidation = validateSkillMd(fetched.files['SKILL.md'].toString('utf8'));
  if (!skillMdValidation.success) {
    return failAndRecord(
      deps,
      source,
      new ExternalSyncError(skillMdValidation.errors.join(', '), 'externalSourceInvalidSkillMd'),
      now
    );
  }

  // 3) 许可证检测：必须能识别依据；识别到但未确认时不发布（首次/变化后）。
  const candidateLicense = detectLicenseFromFiles(fetched.files).license;
  if (!candidateLicense) {
    return requireLicenseConfirmation(deps, source, now);
  }

  // 许可证与上次确认不同（含消失后更换）时必须重新确认，暂停自动发布。
  if (source.licenseBasis && candidateLicense !== source.licenseBasis) {
    return requireLicenseConfirmation(deps, source, now, candidateLicense);
  }
  // 首次：识别到许可证但从未确认。
  if (!source.licenseConfirmedAt) {
    return requireLicenseConfirmation(deps, source, now, candidateLicense);
  }

  // 4) 变更检测：选定范围（含确认文件）的内容指纹比对。只保存指纹，不保留旧
  // 文件快照，因此以指纹是否变化作为发版判据。
  const nextFingerprint = computeContentFingerprint(fetched.files);
  const changed = source.lastContentFingerprint !== nextFingerprint;

  if (!changed) {
    // 无变化：不发版、更新检查时间与下次计划。
    deps.externalSourceRepository.recordSuccess({
      skillName,
      commit: fetched.commit,
      fingerprint: nextFingerprint,
      nextCheckAt: computeNextCheck(source.schedule as CalendarSchedule, now)
    });
    return { outcome: 'unchanged', skillName, commit: fetched.commit };
  }

  // 5) 生成平台元数据（身份/版本权威在平台）。
  const version = nextExternalVersion(
    deps.skillRepository.getReleases(skillName).map((release) => release.version)
  );
  const metadata = mergeUpstreamMetadata({
    platformIdentity: skill.name,
    platformVersion: version,
    detectedLicense: source.licenseBasis ?? candidateLicense,
    upstreamFiles: fetched.files
  });

  // 6) 依赖校验沿用既有发布图校验，不解析自然语言。
  let dependencyLock: Record<string, unknown>;
  try {
    dependencyLock = await resolveReleaseGraph(
      metadata.dependencies,
      new ServerReleaseGraphSource(
        deps.skillRepository,
        deps.giteaService,
        actor.username
      ),
      { rootVisibility: skill.visibility === 'private' ? 'private' : 'public', rootIdentity: skill.name }
    );
  } catch (error) {
    if (error instanceof ReleaseGraphError) {
      return failAndRecord(
        deps,
        source,
        new ExternalSyncError(error.message, error.code),
        now
      );
    }
    return failAndRecord(deps, source, mapUnknownToSyncError(error), now);
  }

  // 7) 字节安全打包：上游 SKILL.md 与资源保留原始字节（ADR-0074 明确禁止改写
  // 上游文件来规避身份校验），身份与版本只写入平台生成的发布元数据。
  const publishedFiles: ByteFileMap = { ...fetched.files };
  const contentHashInput = Object.keys(publishedFiles)
    .sort()
    .map((filePath) => `${filePath}\0${publishedFiles[filePath].toString('base64')}`)
    .join('\n');
  publishedFiles['skill.json'] = Buffer.from(
    `${JSON.stringify(
      {
        ...metadata,
        name: skill.name,
        version,
        skillId: skill.skillId,
        sourceCommit: fetched.commit,
        upstreamCommit: fetched.commit,
        contentChecksum: sha256Integrity(Buffer.from(contentHashInput, 'utf8'))
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  const packageBytes = await createPublishedSkillPackage(
    {
      name: skill.name,
      skillId: skill.skillId ?? '',
      version,
      sourceCommit: fetched.commit,
      releaseManifest: metadata as unknown as Record<string, unknown>,
      dependencyLock
    },
    publishedFiles
  );
  const checksum = sha256Integrity(packageBytes);
  const packagePath = path.join(deps.packageRoot, skill.skillId ?? 'unknown', version, `${checksum}.zip`);
  await fs.mkdir(path.dirname(packagePath), { recursive: true });
  await fs.writeFile(packagePath, packageBytes, { flag: 'wx' });

  // 8) 落 Release（事务边界在 repository）；失败则清理包文件，保留旧版。
  try {
    deps.skillRepository.createRelease({
      skillId: skill.skillId ?? '',
      skillName: skill.name,
      version,
      sourceCommit: fetched.commit,
      packagePath,
      checksum,
      releaseManifest: metadata as unknown as Record<string, unknown>,
      dependencyLock,
      notes: '',
      createdBy: actor.username
    });
  } catch (error) {
    await fs.rm(packagePath, { force: true });
    return failAndRecord(deps, source, mapUnknownToSyncError(error), now);
  }

  if (!deps.skillRepository.getVersions(skill.name).includes(version)) {
    deps.skillRepository.addVersion(skill.name, version);
  }
  deps.skillRepository.markPublished(skill.name);
  // 描述来自上游 SKILL.md（release.json 可覆盖），只在成功发布后更新（ADR-0075）。
  deps.skillRepository.updateSkillDescription(
    skill.name,
    metadata.description ?? skillMdValidation.data.description
  );

  // 首次成功后锁定来源配置。
  deps.externalSourceRepository.markLocked(skillName);
  deps.externalSourceRepository.recordSuccess({
    skillName,
    commit: fetched.commit,
    fingerprint: nextFingerprint,
    nextCheckAt: computeNextCheck(source.schedule as CalendarSchedule, now)
  });

  return {
    outcome: 'published',
    skillName,
    version,
    commit: fetched.commit
  };
}

function nextCheckOrNull(source: ExternalSourceRecord, now: Date): string | null {
  try {
    return computeNextCheck(source.schedule as CalendarSchedule, now);
  } catch {
    return null;
  }
}

function failAndRecord(
  deps: SyncDependencies,
  source: ExternalSourceRecord,
  error: ExternalSyncError,
  now: Date
): Promise<SyncResult> {
  deps.externalSourceRepository.recordFailure({
    skillName: source.skillName,
    error: error.message,
    errorCode: error.code,
    nextCheckAt: nextCheckOrNull(source, now)
  });
  return Promise.resolve({
    outcome: 'failed',
    skillName: source.skillName,
    errorCode: error.code,
    error: error.message
  });
}

function requireLicenseConfirmation(
  deps: SyncDependencies,
  source: ExternalSourceRecord,
  now: Date,
  detected?: string
): Promise<SyncResult> {
  // 不自动发布；记录为失败态并给出稳定代码，等待管理者在 UI 确认许可证。
  deps.externalSourceRepository.recordFailure({
    skillName: source.skillName,
    error: detected
      ? `License changed to ${detected}; confirmation required`
      : 'No clear license basis; confirmation required',
    errorCode: 'externalSourceLicenseConfirmationRequired',
    nextCheckAt: nextCheckOrNull(source, now)
  });
  return Promise.resolve({
    outcome: 'license-confirmation-required',
    skillName: source.skillName,
    errorCode: 'externalSourceLicenseConfirmationRequired'
  });
}
