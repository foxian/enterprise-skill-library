import type {
  OperationRepository,
  OrgApplicationRepository,
  SkillRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import { sanitizeOperationError } from '../db/database.js';
import type { GiteaService } from './gitea.js';

export interface OrganizationDeletionOptions {
  giteaService: GiteaService;
  skillRepository: SkillRepository;
  operationRepository: OperationRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
  orgApplicationRepository: OrgApplicationRepository;
}

// 结构化错误记录:直接抛出普通对象,使 code 与 details 进入
// OperationRepository.failOperation 的脱敏结果,供管理员查询失败原因。
interface DeletionFailure {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

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
    clearApplicationCredential(options, orgName);
    tenantOrganizationRepository.transition(orgName, 'deleted');
  } catch (error) {
    tenantOrganizationRepository.transition(orgName, 'delete_failed', sanitizeOperationError(error));
    throw error;
  }
}

async function cleanupGitBackend(options: OrganizationDeletionOptions, orgName: string): Promise<void> {
  const { giteaService } = options;
  const repos = await giteaService.listOrgRepos(orgName);
  const members = await giteaService.listOrgMembers(orgName);
  const isOrgSpecificAccount = (username: string): boolean => username.startsWith(`${orgName}_`);

  // 删除任何资源前先验证 Resource Provenance:只有 ESL 登记的技能仓库与
  // ESL 创建的组织专属账号才允许自动删除;发现外部资源时停止自动清理,
  // 记录失败原因并交由 ESL Platform Administrator 人工处理。
  const external: string[] = [];
  for (const repo of repos) {
    if (!options.skillRepository.getSkillByGitRepoPath(repo.full_name)) {
      external.push(`repository ${repo.full_name}`);
    }
  }
  for (const member of members) {
    if (!isOrgSpecificAccount(member.username)) continue;
    if (member.username === `${orgName}_admin`) continue;
    if (!options.operationRepository.hasMemberCreateOperation(orgName, member.username)) {
      external.push(`account ${member.username}`);
    }
  }
  if (external.length > 0) {
    throw {
      code: 'EXTERNAL_RESOURCE',
      message: `Automatic deletion stopped: resources without ESL provenance (${external.join(', ')})`,
      details: { resources: external }
    } satisfies DeletionFailure;
  }

  // 可恢复顺序:仓库 → 组织专属账号 → Gitea Organization;每一步只处理
  // 当前仍然存在的资源,重试时从已完成步骤继续。
  for (const repo of repos) {
    await giteaService.deleteRepo(orgName, repo.name);
  }
  for (const member of members) {
    if (isOrgSpecificAccount(member.username)) {
      await giteaService.deleteUser(member.username);
    }
  }
  await giteaService.deleteOrg(orgName);
}

function clearApplicationCredential(options: OrganizationDeletionOptions, orgName: string): void {
  const application = options.orgApplicationRepository.getApplication(orgName);
  if (application?.encryptedPassword) {
    options.orgApplicationRepository.clearEncryptedPasswordById(application.id);
  }
}
