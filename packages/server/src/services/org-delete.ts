import type {
  SkillRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from './gitea.js';

export interface OrganizationDeletionOptions {
  giteaService: GiteaService;
  skillRepository: SkillRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
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
