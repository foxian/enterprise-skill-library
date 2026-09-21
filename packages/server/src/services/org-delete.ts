import type {
  SkillRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from './gitea.js';
import { logTaskFinished, logTaskStarted, type DiagnosticLogger } from '../logging.js';

export interface OrganizationDeletionOptions {
  giteaService: GiteaService;
  skillRepository: SkillRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
}

export const ORG_DELETION_TASK_ID = 'organization-deletion';

/**
 * 组织删除的统一入口（ADR-0034）：先置 `deleting` 让"处理中"对外可见，再执行
 * 跨系统清理。失败由 runOrganizationDeletion 落成 `delete_failed` + 原因，可由
 * 所有者成员或平台管理员重试。所有者成员与平台管理员两条路由共用。
 *
 * logger 由调用方在组合点绑定（ADR-0045）：请求内任务传 request.log 派生的子
 * logger，带上 taskId 与触发请求 id，任务日志因此能回到原始请求的时间线。
 */
export async function performOrganizationDeletion(
  options: OrganizationDeletionOptions,
  orgName: string,
  logger?: DiagnosticLogger
): Promise<void> {
  logTaskStarted(logger, ORG_DELETION_TASK_ID, 'Organization deletion started');
  try {
    options.tenantOrganizationRepository.transition(orgName, 'deleting');
    await runOrganizationDeletion(options, orgName);
  } catch (error) {
    logTaskFinished(logger, ORG_DELETION_TASK_ID, error);
    throw error;
  }
  logTaskFinished(logger, ORG_DELETION_TASK_ID);
}

// 组织删除（ADR-0032）：成员是全局账号（不属于组织），删除只清理
// ESL 登记的技能仓库与组织本身；发现外部仓库时停止自动清理并报错，
// 交由平台管理员人工处理。
export async function runOrganizationDeletion(
  options: OrganizationDeletionOptions,
  orgName: string
): Promise<void> {
  const { tenantOrganizationRepository } = options;
  try {
    if (await options.giteaService.organizationExists(orgName)) {
      await cleanupGitBackend(options, orgName);
    }
    // Git Backend 清理已确认完成后才删除平台记录,避免数据库先行删除
    // 造成 Git Backend 残留资源无法追踪。
    options.skillRepository.deleteSkillsByScope(orgName);
    tenantOrganizationRepository.transition(orgName, 'deleted');
  } catch (error) {
    tenantOrganizationRepository.transition(orgName, 'delete_failed', (error as Error).message);
    throw error;
  }
}

async function cleanupGitBackend(options: OrganizationDeletionOptions, orgName: string): Promise<void> {
  const { giteaService } = options;
  const repos = await giteaService.listOrgRepos(orgName);

  // 删除任何仓库前先验证归属:只有 ESL 登记的技能仓库才允许自动删除;
  // 外部仓库停止自动清理,记录失败原因并交由人工处理。
  const external: string[] = [];
  for (const repo of repos) {
    if (!options.skillRepository.getSkillByGitRepoPath(repo.full_name)) {
      external.push(`repository ${repo.full_name}`);
    }
  }
  if (external.length > 0) {
    throw new Error(
      `Automatic deletion stopped: resources without ESL provenance (${external.join(', ')})`
    );
  }

  for (const repo of repos) {
    await giteaService.deleteRepo(orgName, repo.name);
  }
  await giteaService.deleteOrg(orgName);
}
