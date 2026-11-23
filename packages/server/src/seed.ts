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
// alice 是两个验收组织的所有者成员/发布者；bob 是多组织普通成员；carol 是无组织
// 新注册用户；dave 是「他人个人 private 技能」的发布者（#207 技能目录验收 seed）。
// 密码沿用仓库统一开发密码，不允许在 seed 里出现第二条口令。
// 幂等：GiteaService 的创建调用对已存在（409）保持沉默。
export const DEV_ACCOUNT_PASSWORD = 'esl-dev-password';

/** 技能目录验收 seed 的账号矩阵（#207）。密码统一为 `DEV_ACCOUNT_PASSWORD`。 */
export const DEV_ACCOUNTS = {
  /** acme/beta 所有者成员，技能发布者与组织管理者。 */
  publisher: 'alice',
  /** 多组织普通成员：acme + beta。 */
  multiOrgMember: 'bob',
  /** 无组织新注册用户。 */
  noOrgUser: 'carol',
  /** 他人个人 private 技能的发布者。 */
  otherPerson: 'dave'
} as const;

/**
 * 验收用组织（#207）：acme 已由历史 seed 建立，beta 为本票新增。
 * 两者都预置四个常设团队，并让 bob 以普通成员身份加入，用于验证多组织扁平聚合。
 */
export const DEV_ORGANIZATIONS = [
  { name: 'acme', owners: [DEV_ACCOUNTS.publisher], ordinary: [DEV_ACCOUNTS.multiOrgMember] },
  { name: 'beta', owners: [DEV_ACCOUNTS.publisher], ordinary: [DEV_ACCOUNTS.multiOrgMember] }
] as const;

// 四个常设团队按 ADR-0038 的预置形状幂等补建（与 initializeOrganization 同形）。
const STANDING_TEAMS = [
  ['all-readers', 'read'],
  ['all-writers', 'write'],
  ['all-managers', 'admin'],
  ['org-managers', 'read']
] as const;

export async function seedDevelopmentAccounts(
  giteaService: GiteaService,
  tenantOrganizationRepository?: TenantOrganizationRepository
): Promise<void> {
  // 开发 seed 幂等：重复启动时既存账号/组织不是错误
  const devUsernames: readonly string[] = Object.values(DEV_ACCOUNTS);
  for (const username of devUsernames) {
    await giteaService.createUser(username, DEV_ACCOUNT_PASSWORD, { tolerateExisting: true });
  }

  for (const organization of DEV_ORGANIZATIONS) {
    await giteaService.createOrg(organization.name, { tolerateExisting: true });
    // 与生产路径一致：组织在平台注册表中登记为 active（幂等）
    tenantOrganizationRepository?.create({ orgName: organization.name, status: 'active' });

    const teams = await giteaService.listTeams(organization.name);
    for (const [name, permission] of STANDING_TEAMS) {
      if (!teams.some((team) => team.name === name)) {
        await giteaService.createTeam(organization.name, name, permission);
      }
    }

    // 身份与生产路径同一落实方式（ADR-0038）：所有者成员含 org-managers，
    // 普通成员进三个技能授权团队、但不进 org-managers。
    for (const username of organization.owners) {
      await applyOrgIdentity(giteaService, organization.name, username, 'owner');
    }
    for (const username of organization.ordinary) {
      await applyOrgIdentity(giteaService, organization.name, username, 'ordinary');
    }

    // 与生产路径同一不变量（initializeOrganization / ADR-0033）：用 admin token 建
    // 组织会把站点管理员自动塞进 Owners，平台系统账号不属于任何组织，必须整体移出。
    // 漏掉这一步会让超管以"所有者成员"的身份出现在示例组织里。
    const adminUsername = giteaService.adminUsername;
    if (adminUsername && !devUsernames.includes(adminUsername)) {
      if ((await giteaService.listOrgMembers(organization.name)).some((m) => m.username === adminUsername)) {
        await removeMemberFromOrganization(giteaService, organization.name, adminUsername);
      }
    }
  }
}
