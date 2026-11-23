import type { GiteaService } from './services/gitea.js';
import {
  initDatabase,
  SkillRepository,
  SkillTeamGrantRepository,
  type SkillRecord
} from './db/database.js';
import { DEV_ACCOUNTS, DEV_ORGANIZATIONS } from './seed.js';

/**
 * 技能目录验收数据集（#207 / spec #200 AC12）。
 *
 * 目标：给「多组织普通成员」与「无组织新注册用户」两个固定账号准备一份可重复执行
 * 的数据集，覆盖平台 anonymous/public、组织 public、多形态组织 private 授权、
 * 他人个人 private 直授、本人发布、未发布与已归档，供 PM 与回归测试直接走查。
 *
 * 前置条件：必须先跑 `seedDevelopmentAccounts`——本文件只消费账号/组织/常设团队，
 * 不重复创建它们。所有写入都是幂等的：DB 以技能名 + 版本判存在，Gitea 仓库先
 * `getRepo`，团队按名称判存在，协作者与团队挂载是 Gitea 的幂等 PUT。
 */

/** 验收组织名（acme 为历史 seed 已建，beta 为本票新增）。 */
export const CATALOG_ACCEPTANCE_ORGS: readonly string[] = DEV_ORGANIZATIONS.map((org) => org.name);

/** 自定义团队逻辑名（后端的 `<name>-read/-write/-manage` 由 seed 一并补齐）。 */
export const CATALOG_ACCEPTANCE_CUSTOM_TEAM = 'reviewers';

export type AcceptanceGrant =
  | { kind: 'share-tier'; tier: 'read' | 'write' | 'manage' }
  | { kind: 'custom-team'; team: string; member: string }
  | { kind: 'member'; username: string };

export interface AcceptanceSkillDefinition {
  /** `@scope/name`。 */
  name: string;
  visibility: 'private' | 'public' | 'anonymous';
  status: 'active-published' | 'active-unreleased' | 'archived';
  description: string;
  displayName: string;
  /** 有 Release 才可安装；未发布技能不设置。 */
  version?: string;
  keywords?: string[];
  /** DB 侧的创建者/维护者，也是组织技能的名义发布者。 */
  owner: string;
  grant?: AcceptanceGrant;
}

/**
 * 验收技能矩阵。命名刻意让每个形态都能在走查记录里一眼对上：
 * - platform：`@alice/anon-tool`（anonymous）、`@alice/community-tool`（public）、
 *   `@bob/own-public`（本人个人 public）；carol 还会看到 `@beta/open-tool`。
 * - org：`@acme/public-tool` 与 beta 的 public，加五类 private 授权形态。
 * - granted：`@dave/private-note`（他人直授）与 `@bob/own-private`（本人 private）。
 * - 不出现：`@acme/secret-tool`、`@dave/unshared-note`（无权）、
 *   `@acme/draft-tool`（未发布）、`@acme/retired-tool`（已归档）。
 */
export const CATALOG_ACCEPTANCE_SKILLS: readonly AcceptanceSkillDefinition[] = [
  // 平台公开桶：任何登录用户都可安装；anonymous 同时出现在免登录公开目录。
  {
    name: '@alice/anon-tool',
    visibility: 'anonymous',
    status: 'active-published',
    description: '平台匿名可安装的示例工具',
    displayName: 'Anon Tool',
    version: '1.0.0',
    keywords: ['catalog', 'anonymous'],
    owner: DEV_ACCOUNTS.publisher
  },
  {
    name: '@alice/community-tool',
    visibility: 'public',
    status: 'active-published',
    description: '平台已登录用户可安装的公开工具',
    displayName: 'Community Tool',
    version: '1.0.0',
    keywords: ['catalog', 'community'],
    owner: DEV_ACCOUNTS.publisher
  },
  // 组织 public：bob 落在「我的组织」，carol 落在「平台公开」。
  {
    name: '@acme/public-tool',
    visibility: 'public',
    status: 'active-published',
    description: 'Acme 组织公开工具',
    displayName: 'Acme Public Tool',
    version: '1.0.0',
    keywords: ['catalog', 'acme'],
    owner: DEV_ACCOUNTS.publisher
  },
  {
    name: '@beta/open-tool',
    visibility: 'public',
    status: 'active-published',
    description: 'Beta 组织公开工具，用于验证多组织扁平聚合',
    displayName: 'Beta Open Tool',
    version: '1.0.0',
    keywords: ['catalog', 'beta'],
    owner: DEV_ACCOUNTS.publisher
  },
  // 全组织授权档位 = 挂载常设团队（read/write/manage 三档各一个技能）。
  {
    name: '@acme/all-readers-tool',
    visibility: 'private',
    status: 'active-published',
    description: 'Acme 全员只读授权的私有技能',
    displayName: 'Acme All Readers Tool',
    version: '1.0.0',
    keywords: ['acme', 'standing-team'],
    owner: DEV_ACCOUNTS.publisher,
    grant: { kind: 'share-tier', tier: 'read' }
  },
  {
    name: '@acme/all-writers-tool',
    visibility: 'private',
    status: 'active-published',
    description: 'Acme 全员读写授权的私有技能',
    displayName: 'Acme All Writers Tool',
    version: '1.0.0',
    keywords: ['acme', 'standing-team'],
    owner: DEV_ACCOUNTS.publisher,
    grant: { kind: 'share-tier', tier: 'write' }
  },
  {
    name: '@acme/all-managers-tool',
    visibility: 'private',
    status: 'active-published',
    description: 'Acme 全员管理授权的私有技能',
    displayName: 'Acme All Managers Tool',
    version: '1.0.0',
    keywords: ['acme', 'standing-team'],
    owner: DEV_ACCOUNTS.publisher,
    grant: { kind: 'share-tier', tier: 'manage' }
  },
  // 自定义团队授权：reviewers 逻辑团队，bob 在只读档。
  {
    name: '@acme/custom-team-tool',
    visibility: 'private',
    status: 'active-published',
    description: '经 Acme 自定义团队 reviewers 授权的私有技能',
    displayName: 'Acme Custom Team Tool',
    version: '1.0.0',
    keywords: ['acme', 'custom-team', 'code-review'],
    owner: DEV_ACCOUNTS.publisher,
    grant: { kind: 'custom-team', team: CATALOG_ACCEPTANCE_CUSTOM_TEAM, member: DEV_ACCOUNTS.multiOrgMember }
  },
  // 成员授权（协作者）：组织技能的单独成员授权。
  {
    name: '@acme/member-grant-tool',
    visibility: 'private',
    status: 'active-published',
    description: '经 Acme 成员授权（协作者）到达普通成员的私有技能',
    displayName: 'Acme Member Grant Tool',
    version: '1.0.0',
    keywords: ['acme', 'member-grant'],
    owner: DEV_ACCOUNTS.publisher,
    grant: { kind: 'member', username: DEV_ACCOUNTS.multiOrgMember }
  },
  // 无权组织 private：bob 是组织成员但没有被授权；carol 也不是组织成员。
  {
    name: '@acme/secret-tool',
    visibility: 'private',
    status: 'active-published',
    description: '未对多组织成员与无组织用户授权的 Acme 私有技能',
    displayName: 'Acme Secret Tool',
    version: '1.0.0',
    keywords: ['acme', 'secret'],
    owner: DEV_ACCOUNTS.publisher
  },
  // 他人个人 private：dave 直授给 bob。
  {
    name: '@dave/private-note',
    visibility: 'private',
    status: 'active-published',
    description: 'Dave 直授给多组织成员的私有笔记技能',
    displayName: 'Dave Private Note',
    version: '1.0.0',
    keywords: ['dave', 'private-note'],
    owner: DEV_ACCOUNTS.otherPerson,
    grant: { kind: 'member', username: DEV_ACCOUNTS.multiOrgMember }
  },
  // 他人个人 private 但未授权：留作越权红线对照。
  {
    name: '@dave/unshared-note',
    visibility: 'private',
    status: 'active-published',
    description: '未授权的他人个人私有技能',
    displayName: 'Dave Unshared Note',
    version: '1.0.0',
    keywords: ['dave', 'unshared'],
    owner: DEV_ACCOUNTS.otherPerson
  },
  // 本人发布：private 进「授权给我」并显示「我的技能」，public 进「平台公开」。
  {
    name: '@bob/own-private',
    visibility: 'private',
    status: 'active-published',
    description: '多组织成员本人发布的私有技能',
    displayName: 'Bob Own Private',
    version: '1.0.0',
    keywords: ['bob', 'own-private'],
    owner: DEV_ACCOUNTS.multiOrgMember
  },
  {
    name: '@bob/own-public',
    visibility: 'public',
    status: 'active-published',
    description: '多组织成员本人发布的公开技能',
    displayName: 'Bob Own Public',
    version: '1.0.0',
    keywords: ['bob', 'own-public'],
    owner: DEV_ACCOUNTS.multiOrgMember
  },
  // 不可安装形态：未发布（无 Release）与已归档（有 Release）。
  {
    name: '@acme/draft-tool',
    visibility: 'public',
    status: 'active-unreleased',
    description: '未发布的 Acme 草稿技能',
    displayName: 'Acme Draft Tool',
    keywords: ['acme', 'draft'],
    owner: DEV_ACCOUNTS.publisher
  },
  {
    name: '@acme/retired-tool',
    visibility: 'public',
    status: 'archived',
    description: '已归档的 Acme 技能',
    displayName: 'Acme Retired Tool',
    version: '1.0.0',
    keywords: ['acme', 'retired'],
    owner: DEV_ACCOUNTS.publisher
  }
];

const SHARE_TIER_TEAMS = {
  read: { name: 'all-readers', permission: 'read' },
  write: { name: 'all-writers', permission: 'write' },
  manage: { name: 'all-managers', permission: 'admin' }
} as const;

function splitIdentity(name: string): { scope: string; skillName: string } {
  const slash = name.indexOf('/');
  if (!name.startsWith('@') || slash < 0) {
    throw new Error(`Invalid acceptance skill identity: ${name}`);
  }
  return { scope: name.slice(1, slash), skillName: name.slice(slash + 1) };
}

async function ensureRepository(
  giteaService: GiteaService,
  scope: string,
  skillName: string,
  isPrivate: boolean
): Promise<void> {
  if (await giteaService.getRepo(scope, skillName)) return;
  if (CATALOG_ACCEPTANCE_ORGS.includes(scope)) {
    await giteaService.createOrganizationRepo(scope, skillName, isPrivate);
  } else {
    await giteaService.createRepo(scope, skillName, isPrivate);
  }
}

function ensureSkill(
  repository: SkillRepository,
  definition: AcceptanceSkillDefinition
): SkillRecord {
  const existing = repository.getSkill(definition.name);
  const { scope, skillName } = splitIdentity(definition.name);
  if (!existing) {
    return repository.createServerSkill({
      name: definition.name,
      scope,
      skillName,
      description: definition.description,
      displayName: definition.displayName,
      createdBy: definition.owner,
      owner: definition.owner,
      maintainers: [definition.owner],
      visibility: definition.visibility,
      status: definition.status,
      gitRepoPath: `${scope}/${skillName}`
    });
  }
  // 收敛既有数据：本数据集是幂等夹具，重复执行不允许把归档技能留在可安装状态。
  if (definition.status === 'archived' && existing.status !== 'archived') {
    repository.archiveSkill(definition.name);
  }
  return repository.getSkill(definition.name)!;
}

function ensureRelease(
  repository: SkillRepository,
  skill: SkillRecord,
  definition: AcceptanceSkillDefinition
): void {
  if (!definition.version) return;
  if (repository.getReleases(definition.name).some((release) => release.version === definition.version)) {
    return;
  }
  repository.createRelease({
    skillId: skill.skillId!,
    skillName: definition.name,
    version: definition.version,
    sourceCommit: '0000000000000000000000000000000000000000',
    packagePath: `packages/${skill.skillName}-${definition.version}.tgz`,
    checksum: `seed-${definition.name}-${definition.version}`,
    releaseManifest: {
      schemaVersion: 4,
      name: definition.name,
      version: definition.version,
      license: 'MIT',
      displayName: definition.displayName,
      keywords: definition.keywords ?? [],
      compatibility: {},
      dependencies: {}
    },
    dependencyLock: {},
    createdBy: definition.owner
  });
  if (!repository.getVersions(definition.name).includes(definition.version)) {
    repository.addVersion(definition.name, definition.version);
  }
}

async function ensureStandingTeam(
  giteaService: GiteaService,
  scope: string,
  name: string,
  permission: 'read' | 'write' | 'admin'
): Promise<number> {
  const teams = await giteaService.listTeams(scope);
  const existing = teams.find((team) => team.name === name);
  if (existing) return existing.id;
  return (await giteaService.createTeam(scope, name, permission)).id;
}

/** 自定义团队的逻辑投影（ADR-0029/0037）：`<name>-read/-write/-manage` 三个后端团队。 */
async function ensureCustomTeam(
  giteaService: GiteaService,
  scope: string,
  logicalName: string
): Promise<number> {
  const readTeamId = await ensureStandingTeam(giteaService, scope, `${logicalName}-read`, 'read');
  await ensureStandingTeam(giteaService, scope, `${logicalName}-write`, 'write');
  await ensureStandingTeam(giteaService, scope, `${logicalName}-manage`, 'admin');
  return readTeamId;
}

async function ensureGrant(
  giteaService: GiteaService,
  skillTeamGrantRepository: SkillTeamGrantRepository,
  definition: AcceptanceSkillDefinition
): Promise<void> {
  const grant = definition.grant;
  if (!grant) return;
  const { scope, skillName } = splitIdentity(definition.name);

  switch (grant.kind) {
    case 'share-tier': {
      const tier = SHARE_TIER_TEAMS[grant.tier];
      const teamId = await ensureStandingTeam(giteaService, scope, tier.name, tier.permission);
      await giteaService.addTeamRepo(teamId, scope, skillName);
      return;
    }
    case 'custom-team': {
      const readTeamId = await ensureCustomTeam(giteaService, scope, grant.team);
      await giteaService.addTeamMember(readTeamId, grant.member);
      await giteaService.addTeamRepo(readTeamId, scope, skillName);
      skillTeamGrantRepository.set(definition.name, readTeamId, 'read');
      return;
    }
    case 'member': {
      await giteaService.addCollaborator(scope, skillName, grant.username, 'read');
      return;
    }
  }
}

/**
 * 幂等写入技能目录验收数据集。返回写入后的技能定义，便于测试与文档共用同一份矩阵。
 */
export async function seedCatalogAcceptanceData(
  dbPath: string,
  giteaService: GiteaService
): Promise<readonly AcceptanceSkillDefinition[]> {
  const db = initDatabase(dbPath);
  try {
    const repository = new SkillRepository(db);
    const skillTeamGrantRepository = new SkillTeamGrantRepository(db);

    for (const definition of CATALOG_ACCEPTANCE_SKILLS) {
      const { scope, skillName } = splitIdentity(definition.name);
      await ensureRepository(giteaService, scope, skillName, definition.visibility === 'private');
      const skill = ensureSkill(repository, definition);
      ensureRelease(repository, skill, definition);
      await ensureGrant(giteaService, skillTeamGrantRepository, definition);
      if (definition.status === 'archived') {
        await giteaService.setRepositoryArchived(scope, skillName, true);
      }
    }

    return CATALOG_ACCEPTANCE_SKILLS;
  } finally {
    db.close();
  }
}
