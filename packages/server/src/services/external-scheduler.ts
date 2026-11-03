import type {
  ExternalSourceRecord,
  ExternalSourceRepository
} from '../db/database.js';
import type { SkillRepository } from '../db/database.js';
import type { GiteaService } from './gitea.js';
import type { ExternalGitFetcher } from './external-git-fetcher.js';
import {
  computeNextCheck,
  synchronizeExternalReference,
  type SyncDependencies
} from './external-sync-service.js';
import type { CalendarSchedule } from '@esl/core';
import { logTaskFinished, logTaskStarted, taskLogger } from '../logging.js';
import type { DiagnosticLogger } from '../logging.js';

// 外部引用日历调度（ADR-0074）：周期扫描到期引用，复用立即同步的幂等发布路径。
// 暂停/归档引用不执行；恢复后靠 catchup_due 最多补跑一次。

export const EXTERNAL_SCHEDULER_INTERVAL_MS = 60 * 60 * 1000; // 每小时扫描一次
const SCHEDULER_TASK_ID = 'external-reference-sync';

export interface SchedulerScanOptions {
  now?: Date;
  // 仅运行被标记需要补跑的引用（恢复场景）。
  catchupOnly?: boolean;
}

// 决定本轮要处理的引用：到期或需要补跑；不选暂停/同步中/归档。
export function selectDueReferences(
  externalSourceRepository: ExternalSourceRepository,
  skillRepository: SkillRepository,
  options: SchedulerScanOptions = {}
): ExternalSourceRecord[] {
  const now = options.now ?? new Date();
  const selected: ExternalSourceRecord[] = [];

  for (const record of externalSourceRepository.listAll()) {
    if (record.syncState === 'paused' || record.syncState === 'syncing') continue;
    const skill = skillRepository.getSkill(record.skillName);
    if (!skill || skill.status === 'archived') continue;

    if (record.catchupDue) {
      selected.push(record);
      continue;
    }
    if (options.catchupOnly) continue;
    if (record.nextCheckAt && record.nextCheckAt <= now.toISOString()) {
      selected.push(record);
    }
  }
  return selected;
}

export interface ExternalSchedulerDeps {
  externalSourceRepository: ExternalSourceRepository;
  skillRepository: SkillRepository;
  giteaService: GiteaService;
  fetcher: ExternalGitFetcher;
  packageRoot: string;
  logger?: DiagnosticLogger;
  // 为补跑/计划执行确定操作者：同步是平台任务，以引用 owner 作为行为主体。
}

function syncDeps(deps: ExternalSchedulerDeps): SyncDependencies {
  return {
    skillRepository: deps.skillRepository,
    externalSourceRepository: deps.externalSourceRepository,
    giteaService: deps.giteaService,
    fetcher: deps.fetcher,
    packageRoot: deps.packageRoot
  };
}

// 运行一次扫描：逐个处理到期引用。并发重叠由 repository 认领闸门保证幂等。
export async function runExternalScheduler(
  deps: ExternalSchedulerDeps,
  options: SchedulerScanOptions = {}
): Promise<{ processed: number; results: Array<{ skillName: string; outcome: string }> }> {
  const now = options.now ?? new Date();
  const due = selectDueReferences(
    deps.externalSourceRepository,
    deps.skillRepository,
    { ...options, now }
  );

  const results: Array<{ skillName: string; outcome: string }> = [];
  for (const record of due) {
    // 原子认领：失败说明已有手动/定时任务在跑，跳过（幂等）。
    if (!deps.externalSourceRepository.claimForSync(record.skillName)) continue;

    const skill = deps.skillRepository.getSkill(record.skillName);
    const actor = { username: skill?.owner ?? 'system' };
    try {
      const result = await synchronizeExternalReference(syncDeps(deps), record.skillName, actor, { now });
      results.push({ skillName: record.skillName, outcome: result.outcome });
    } catch (error) {
      results.push({
        skillName: record.skillName,
        outcome: (error as { code?: string }).code ?? 'failed'
      });
    }
  }
  return { processed: due.length, results };
}

// 在 app 上安装调度定时器（unref + onClose 清理），与下载日志清理同款。
export function installExternalScheduler(
  app: import('fastify').FastifyInstance,
  deps: ExternalSchedulerDeps
): void {
  const logger = taskLogger(app.log, SCHEDULER_TASK_ID);

  const runner = async (): Promise<void> => {
    logTaskStarted(logger, SCHEDULER_TASK_ID, 'Synchronizing due external references');
    try {
      await runExternalScheduler({ ...deps, logger });
      logTaskFinished(logger, SCHEDULER_TASK_ID);
    } catch (error) {
      logTaskFinished(logger, SCHEDULER_TASK_ID, error);
    }
  };

  // 启动后下一个 tick 先处理可能的补跑/到期，避免阻塞启动。
  const initial = setImmediate(() => {
    void runner();
  });
  const timer = setInterval(() => {
    void runner();
  }, EXTERNAL_SCHEDULER_INTERVAL_MS);
  timer.unref();
  app.addHook('onClose', () => {
    clearImmediate(initial);
    clearInterval(timer);
  });
}

// 供创建/更新配置后重算下次检查时间。
export { computeNextCheck };
