import fs from 'node:fs/promises';
import path from 'node:path';
import {
  computeCleanupPlan,
  computeDependencyImpact,
  computeRequiredIdentities,
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
  type CleanupCandidate,
  type InstallManifestSkill,
  type LocalStoreOptions,
  type ToolName
} from '@esl/core';
import { installTargetDir, projectSkillsDir } from './network-options.js';
import { consumerProjectRootHint } from './consumer-project-root.js';
import { persistRetainedCandidates, resolveDependencyCleanup } from './dependency-cleanup.js';

export interface UninstallOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  noAdapt?: boolean;
  /** 显式接受删除仍被依赖的目标所带来的缺失影响（等价于本次全部影响）。 */
  force?: boolean;
  /** 同名技能存在多个实例来源时指定要移除的来源。 */
  instanceId?: string;
  /** 只用于提示判断；默认 projectRoot / process.cwd()。 */
  cwd?: string;
  /** 清理不再需要的传递依赖；缺省表示尚未选择（默认全部保留）。 */
  cleanup?: string[];
  cleanupProvided?: boolean;
  /** Agent 重跑带回的影响确认范围。 */
  acceptDependencyImpact?: string[];
  agentMode?: boolean;
  interactive?: boolean;
  selectCleanup?: (candidates: CleanupCandidate[]) => Promise<string[]>;
  confirmImpact?: (message: string) => Promise<boolean>;
}

export interface UninstallResult {
  removedLinks: Array<{ identity: string; tool: ToolName; targetDir: string; status: 'removed' | 'missing' | 'conflict' }>;
  sourceRemoved: boolean;
  sourcePath?: string;
  /** 本次由用户选择清理的传递依赖身份。 */
  reclaimed?: string[];
  /** 列出的可清理候选（默认全部保留）。 */
  cleanupCandidates?: CleanupCandidate[];
  /** 因目标被删除而缺少依赖的技能。 */
  impactAffected?: string[];
  /** 用户在终端拒绝接受依赖影响，未执行删除。 */
  impactDeclined?: boolean;
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
  // 以「去掉该根之后」的剩余图为基准：目标仍被其他根需要时先说明影响。
  const requiredWithoutName = await computeRequiredIdentities(dependencyRoot, storeRoot, {
    excludeRoot: isDirect ? name : undefined
  });
  const needersOfName = requiredWithoutName.get(name);
  const affected = needersOfName
    ? await computeDependencyImpact(dependencyRoot, storeRoot, name)
    : [];
  if (affected.length === 0 && needersOfName) {
    affected.push(...needersOfName);
  }

  // 清理候选按「目标已移除」的图计算；选择与删除分开，默认全部保留。
  // 目标自己（无论直接还是传递）都不应再作为可清理候选展示。
  const cleanupPlan = await computeCleanupPlan({
    dependencyRoot,
    storeRoot,
    excludeRoots: isDirect ? [name] : []
  });
  const cleanupCandidates = cleanupPlan.candidates.filter(
    (candidate) =>
      candidate.identity !== name ||
      (candidate.instanceId ?? undefined) !== (entry.instanceId ?? undefined)
  );
  const decision = await resolveDependencyCleanup({
    command: 'uninstall',
    candidates: cleanupCandidates,
    protectedDependents: cleanupPlan.protectedDependents,
    cleanup: options.cleanup,
    cleanupProvided: options.cleanupProvided ?? options.cleanup !== undefined,
    agentMode: options.agentMode,
    interactive: options.interactive,
    selectCleanup: options.selectCleanup,
    impact: affected.length > 0 ? { target: name, affected } : undefined,
    acceptDependencyImpact: options.acceptDependencyImpact,
    force: options.force,
    confirmImpact: options.confirmImpact
  });
  if (decision.impactDeclined) {
    return {
      removedLinks: [],
      sourceRemoved: false,
      cleanupCandidates,
      impactAffected: affected,
      impactDeclined: true
    };
  }

  const removedLinks = await removeInstalledIdentity(name, entry, {
    storeRoot,
    dependencyRoot,
    level,
    projectRoot,
    homeDir: options.homeDir
  });

  // 只删除用户确认选中的候选；未选项持久保留，后续不再被当作孤儿回收。
  const reclaimed: string[] = [];
  const remainingManifest = await loadInstallManifest(storeRoot);
  for (const identity of decision.selected) {
    const candidate = cleanupCandidates.find((item) => item.identity === identity);
    const installedEntry = findInstalledSkill(
      remainingManifest,
      identity,
      candidate?.instanceId
    )?.entry;
    if (!installedEntry) continue;
    await removeInstalledIdentity(identity, installedEntry, {
      storeRoot,
      dependencyRoot,
      level,
      projectRoot,
      homeDir: options.homeDir
    });
    reclaimed.push(identity);
  }
  if (decision.persistRetention) {
    await persistRetainedCandidates(storeRoot, cleanupCandidates, decision.retained);
  }

  return {
    removedLinks,
    sourceRemoved: entry.source !== 'link',
    sourcePath: entry.source === 'link' ? entry.resolved : undefined,
    reclaimed,
    cleanupCandidates,
    impactAffected: affected.length > 0 ? affected : undefined
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
