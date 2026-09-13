import { pathToFileURL } from 'node:url';
import type { GiteaService } from './services/gitea.js';
import { initDatabase, SkillRepository } from './db/database.js';

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

export async function seedDevelopmentAccounts(giteaService: GiteaService): Promise<void> {
  await giteaService.createUser('alice', DEV_ACCOUNT_PASSWORD);
  await giteaService.createUser('bob', DEV_ACCOUNT_PASSWORD);
  await giteaService.createOrg('acme');

  const teams = await giteaService.listTeams('acme');
  const owners = teams.find((team) => team.permission === 'owner');
  if (owners) {
    await giteaService.addTeamMember(owners.id, 'alice');
  } else {
    await giteaService.createTeam('acme', 'Owners', 'admin');
  }
  // bob 的成员身份挂在组织读团队上；常设团队机制（#55）落地前
  // 先用普通 read 团队承载。
  let readTeam = teams.find((team) => team.permission === 'read');
  if (!readTeam) {
    readTeam = await giteaService.createTeam('acme', 'dev-readers', 'read');
  }
  await giteaService.addTeamMember(readTeam.id, 'bob');
}
