import { pathToFileURL } from 'node:url';
import type { GiteaService } from './services/gitea.js';
import { initDatabase, SkillRepository, type TenantOrganizationRepository } from './db/database.js';

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
// alice 拥有组织 acme（Owners 成员 = Organization Admin），bob 是普通成员。
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

  const teams = await giteaService.listTeams('acme');
  // Gitea 新建组织自带 Owners 团队（permission=owner），找不到即环境异常
  const owners = teams.find((team) => team.permission === 'owner');
  if (!owners) {
    throw new Error('Development seed expected the organization Owners team to exist');
  }
  await giteaService.addTeamMember(owners.id, 'alice');
  // bob 是普通成员：与生产路径同一不变量（成员 ∈ 三个常设团队），
  // 常设团队不存在时按 ADR-0032 的预置形状补建。
  for (const [name, permission] of [
    ['all-readers', 'read'],
    ['all-writers', 'write'],
    ['all-managers', 'admin']
  ] as const) {
    let team = teams.find((candidate) => candidate.name === name);
    if (!team) {
      team = await giteaService.createTeam('acme', name, permission);
    }
    await giteaService.addTeamMember(team.id, 'alice');
    await giteaService.addTeamMember(team.id, 'bob');
  }
}
