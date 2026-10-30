import fs from 'node:fs/promises';
import path from 'node:path';
import {
  findInstalledSkill,
  loadInstallManifest,
  loadSkillsJson,
  removeDirectory,
  removeInstalledSkill,
  removeLinkedSkillDirectory,
  removeLockEntry,
  removeSkillDependency,
  removeToolLinks,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  SUPPORTED_TOOLS,
  type InstallManifestSkill,
  type LocalStoreOptions,
  type ToolName
} from '@esl/core';
import { installTargetDir, projectSkillsDir } from './network-options.js';
import { computeRequiredIdentities } from './dependency-graph.js';
import { consumerProjectRootHint } from './consumer-project-root.js';

export interface UninstallOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  noAdapt?: boolean;
  force?: boolean;
  /** 同名技能存在多个实例来源时指定要移除的来源。 */
  instanceId?: string;
  /** 只用于提示判断；默认 projectRoot / process.cwd()。 */
  cwd?: string;
}

export interface UninstallResult {
  removedLinks: Array<{ identity: string; tool: ToolName; targetDir: string; status: 'removed' | 'missing' | 'conflict' }>;
  sourceRemoved: boolean;
  sourcePath?: string;
  /** 目标仍是其他根的传递依赖：只从 `.skills.json` 降级为传递依赖，副本保留。 */
  demotedToTransitive?: boolean;
  /** 本次回收的不再被任何剩余根需要的传递依赖身份。 */
  reclaimed?: string[];
}

function throwIfToolLinkConflicts(
  removedLinks: UninstallResult['removedLinks']
): void {
  const conflicts = removedLinks.filter((result) => result.status === 'conflict');
  if (conflicts.length > 0) {
    throw new Error(
      `Tool link conflict; content was not removed: ${conflicts
        .map((result) => `${result.tool} (${result.targetDir})`)
        .join(', ')}`
    );
  }
}

/** 彻底移除一个已装身份：ESL 管理 Tool Link、Store 副本/链接、清单与锁记录。 */
export async function removeInstalledIdentity(
  identity: string,
  entry: InstallManifestSkill,
  ctx: {
    storeRoot: string;
    dependencyRoot: string;
    level: 'global' | 'project';
    projectRoot: string;
    homeDir?: string;
  }
): Promise<UninstallResult['removedLinks']> {
  const removedLinks = await removeToolLinks({
    storeRoot: ctx.storeRoot,
    identity,
    instanceId: entry.instanceId,
    tools: [...SUPPORTED_TOOLS],
    level: ctx.level
  });
  throwIfToolLinkConflicts(removedLinks);
  if (entry.source === 'link') {
    await removeLinkedSkillDirectory(identity, ctx.storeRoot);
  } else {
    const targetDir = ctx.level === 'global'
      ? installTargetDir(identity, { homeDir: ctx.homeDir }, entry.instanceId)
      : projectSkillsDir(ctx.projectRoot, identity, entry.instanceId);
    await removeDirectory(targetDir);
  }
  await removeSkillDependency(ctx.dependencyRoot, identity);
  await removeLockEntry(ctx.dependencyRoot, identity, entry.instanceId);
  await removeInstalledSkill(ctx.storeRoot, identity, entry.instanceId);
  return removedLinks;
}

export async function executeUninstall(name: string, options: UninstallOptions = {}): Promise<UninstallResult> {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = options.projectRoot ?? cwd;
  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global ? storeRoot : projectRoot;
  const level = options.global ? 'global' : 'project';
  const installManifest = await loadInstallManifest(storeRoot);
  const skillsJson = await loadSkillsJson(dependencyRoot);
  const resolvedInstanceId =
    options.instanceId ?? (options.global ? undefined : skillsJson.instances?.[name]);
  const found = findInstalledSkill(installManifest, name, resolvedInstanceId);
  const entry = found?.entry;
  if (!entry) {
    let message = `Skill ${name} is not installed by ESL`;
    const sameIdentity = Object.values(installManifest.skills).filter((candidate) => candidate.identity === name);
    if (sameIdentity.length > 0) {
      message += `. It is installed from multiple Server instances (${sameIdentity
        .map((candidate) => candidate.instanceId)
        .filter(Boolean)
        .join(', ')}); pass --instance-id to choose one.`;
    }
    const hint = await consumerProjectRootHint({ global: options.global, cwd });
    if (hint) {
      message += `. ${hint}`;
    }
    throw new Error(message);
  }

  const isDirect = Object.hasOwn(skillsJson.skills, name);
  // 以「去掉该根之后」的剩余图为基准：目标仍被其他根需要时不能直接删副本。
  const requiredWithoutName = await computeRequiredIdentities(dependencyRoot, storeRoot, {
    excludeRoot: name
  });
  const needersOfName = requiredWithoutName.get(name);
  if (needersOfName) {
    const needers = [...needersOfName];
    if (!isDirect) {
      throw new Error(
        `Skill ${name} is required by ${needers.join(', ')}; uninstall the root that needs it first`
      );
    }
    // 既是直接依赖又被其他根当传递依赖：只降级，保留副本。
    await removeSkillDependency(dependencyRoot, name);
    return { removedLinks: [], sourceRemoved: false, demotedToTransitive: true };
  }

  const removedLinks = await removeInstalledIdentity(name, entry, {
    storeRoot,
    dependencyRoot,
    level,
    projectRoot,
    homeDir: options.homeDir
  });

  // 回收不再是任何剩余根需要（直接或经发布依赖图）的传递依赖。
  const remainingManifest = await loadInstallManifest(storeRoot);
  const reclaimed: string[] = [];
  for (const [identity, installedEntry] of Object.entries(remainingManifest.skills)) {
    const installedIdentity = installedEntry.identity ?? identity;
    // 同一 Identity 的其他实例仍由剩余根声明；不能把「按身份排除」误当成
    // 「该身份的所有实例都不再需要」。
    if (installedIdentity === name) continue;
    if (requiredWithoutName.has(installedIdentity)) continue;
    await removeInstalledIdentity(installedIdentity, installedEntry, {
      storeRoot,
      dependencyRoot,
      level,
      projectRoot,
      homeDir: options.homeDir
    });
    reclaimed.push(installedIdentity);
  }

  return {
    removedLinks,
    sourceRemoved: entry.source !== 'link',
    sourcePath: entry.source === 'link' ? entry.resolved : undefined,
    reclaimed
  };
}

const ESL_GITIGNORE_MARKER = '# ESL managed (do not edit)';
const ESL_GITIGNORE_ENTRIES = ['.eslib/'];

export async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let content = '';

  try {
    content = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    // .gitignore does not exist yet.
  }

  const missingEntries = ESL_GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry));
  if (missingEntries.length === 0) {
    return;
  }

  if (content.includes(ESL_GITIGNORE_MARKER)) {
    await fs.writeFile(
      gitignorePath,
      `${content.trimEnd()}\n${missingEntries.join('\n')}\n`,
      'utf8'
    );
    return;
  }

  const newBlock = `\n${ESL_GITIGNORE_MARKER}\n${missingEntries.join('\n')}\n`;
  await fs.writeFile(gitignorePath, content.trimEnd() + newBlock, 'utf8');
}
