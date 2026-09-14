import { pathToFileURL } from 'node:url';
import type { GiteaService } from './services/gitea.js';
import { initDatabase, SkillRepository, type TenantOrganizationRepository } from './db/database.js';
import { applyOrgIdentity, removeMemberFromOrganization } from './services/organization-membership.js';

const sampleSkill = {
  name: '@myorg/my-skill',
  scope: 'myorg',
  skillName: 'my-skill',
  description: 'Sample seeded skill',
  createdBy: 'dev',
  owner: 'platform',
  maintainers: ['dev'],
  visibility: 'public',
  gitRepoPath: 'myorg/my-skill'
};

export function seedDevelopmentData(dbPath: string): void {
  const db = initDatabase(dbPath);
  const repo = new SkillRepository(db);
  try {
    if (!repo.getSkill(sampleSkill.name)) {
      repo.createSkill(sampleSkill);
    }
    if (!repo.getVersions(sampleSkill.name).includes('0.1.0')) {
      repo.addVersion(sampleSkill.name, '0.1.0');
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.env.DATABASE_PATH;
  if (!dbPath) {
    console.error('Missing required environment variable: DATABASE_PATH');
    process.exitCode = 1;
  } else {
    seedDevelopmentData(dbPath);
    console.log('Seeded development skill metadata');
  }
}

// 开发环境自动 seed 的全局账号（ADR-0032）：账号无 <org>_ 前缀。
// alice 是组织 acme 的所有者成员，bob 是普通成员（ADR-0036）。
// 幂等：GiteaService 的创建调用对已存在（409）保持沉默。
const DEV_ACCOUNT_PASSWORD = 'esl-dev-password';

export async function seedDevelopmentAccounts(
  giteaService: GiteaService,
  tenantOrganizationRepository?: TenantOrganizationRepository
): Promise<void> {
  // 开发 seed 幂等：重复启动时既存账号/组织不是错误
  await giteaService.createUser('alice', DEV_ACCOUNT_PASSWORD, { tolerateExisting: true });
  await giteaService.createUser('bob', DEV_ACCOUNT_PASSWORD, { tolerateExisting: true });
  await giteaService.createOrg('acme', { tolerateExisting: true });
  // 与生产路径一致：组织在平台注册表中登记为 active（幂等）
  tenantOrganizationRepository?.create({ orgName: 'acme', status: 'active' });

  // 三个常设团队按 ADR-0032 的预置形状幂等补建（与 initializeOrganization 同形）
  const teams = await giteaService.listTeams('acme');
  for (const [name, permission] of [
    ['all-readers', 'read'],
    ['all-writers', 'write'],
    ['all-managers', 'admin']
  ] as const) {
    if (!teams.some((team) => team.name === name)) {
      await giteaService.createTeam('acme', name, permission);
    }
  }

  // 身份与生产路径同一落实方式（ADR-0036）：alice 是所有者成员（三档嵌套，四支
  // 团队全员到位），bob 是普通成员（只进只读、读写两个常设团队）。
  await applyOrgIdentity(giteaService, 'acme', 'alice', 'owner');
  await applyOrgIdentity(giteaService, 'acme', 'bob', 'ordinary');

  // 与生产路径同一不变量（initializeOrganization / ADR-0033）：用 admin token 建
  // 组织会把站点管理员自动塞进 Owners，平台系统账号不属于任何组织，必须整体移出。
  // 漏掉这一步会让超管以"所有者成员"的身份出现在示例组织里。
  const adminUsername = giteaService.adminUsername;
  if (adminUsername && adminUsername !== 'alice' && adminUsername !== 'bob') {
    if ((await giteaService.listOrgMembers('acme')).some((m) => m.username === adminUsername)) {
      await removeMemberFromOrganization(giteaService, 'acme', adminUsername);
    }
  }
}
