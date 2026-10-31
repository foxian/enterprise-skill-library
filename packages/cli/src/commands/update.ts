import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
  computeCleanupPlan,
  findOutOfRangeDependents,
  resolveProjectStorePaths,
  BUILTIN_SPECIFIER_PREFIX,
  BUILTIN_IDENTITY,
  loadBuiltinPackageOrThrow,
  highestStableVersion,
  isBuiltinIdentity,
  findInstalledSkill,
  findLockEntry,
  loadInstallManifest,
  loadSkillsJson,
  loadSkillsLock,
  renameSkillState,
  repairRecordedToolLinks,
  resolveLocalStorePaths,
  validateSkillDirectory,
  type CleanupCandidate,
  type InstallManifestSkill
} from '@esl/core';
import { executeInfo } from './info.js';
import { executeInstall } from './install.js';
import { resolveBuiltinDir } from '../builtin-dir.js';
import { removeInstalledIdentity } from './uninstall.js';
import {
  publishedInstallTargetDir,
  publishedProjectSkillsDir,
  requireFreshToken
} from './network-options.js';
import type { NetworkCommandOptions } from './network-options.js';
import { assertNotNestedConsumerStore } from './consumer-project-root.js';
import { persistRetainedCandidates, resolveDependencyCleanup } from './dependency-cleanup.js';
import { notify } from '../output.js';

export interface UpdateOptions extends NetworkCommandOptions {
  projectRoot?: string;
  skillName?: string;
  global?: boolean;
  /** 只用于嵌套 Store 拒绝判断；默认 projectRoot / process.cwd()。 */
  cwd?: string;
  /** 同名技能存在多个实例来源时指定目标来源。 */
  instanceId?: string;
  /** 清理不再需要的旧依赖；缺省表示尚未选择（默认全部保留）。 */
  cleanup?: string[];
  cleanupProvided?: boolean;
  agentMode?: boolean;
  interactive?: boolean;
  selectCleanup?: (candidates: CleanupCandidate[]) => Promise<string[]>;
}

export interface UpdateResultEntry {
  name: string;
  from: string;
  skipped?: 'link';
  to: string;
}

export type UpdateResult = UpdateResultEntry[];

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function isBlockingNetworkConfigurationError(error: unknown): boolean {
  const message = (error as Error).message ?? '';
  return (
    message.startsWith('Missing server;') ||
    message.startsWith('Missing token;') ||
    message.startsWith('Login expired;')
  );
}

interface UpdateContext {
  dependencyRoot: string;
  storeRoot: string;
  options: UpdateOptions;
  lockJson: Awaited<ReturnType<typeof loadSkillsLock>>;
  results: UpdateResult;
  targetIdentities: Set<string>;
  /** 本次是否真的改动了安装内容；未改动时不主动提供清理选择。 */
  didUpdate: boolean;
}

/** 服务端重命名后的本地目录与状态迁移；直接根与传递依赖共用。 */
async function migrateRenamedInstall(input: {
  name: string;
  resolvedName: string;
  instanceId?: string;
  options: UpdateOptions;
  dependencyRoot: string;
  storeRoot: string;
  needsUpdate: boolean;
}): Promise<void> {
  const { name, resolvedName, instanceId, options, dependencyRoot, storeRoot, needsUpdate } = input;
  const oldDirectory = options.global
    ? publishedInstallTargetDir(name, options, instanceId)
    : publishedProjectSkillsDir(dependencyRoot, name, instanceId);
  const newDirectory = options.global
    ? publishedInstallTargetDir(resolvedName, options, instanceId)
    : publishedProjectSkillsDir(dependencyRoot, resolvedName, instanceId);
  if (!needsUpdate && await directoryExists(oldDirectory)) {
    await fs.mkdir(path.dirname(newDirectory), { recursive: true });
    await fs.rename(oldDirectory, newDirectory);
  } else {
    await fs.rm(oldDirectory, { recursive: true, force: true });
  }
  await renameSkillState(dependencyRoot, storeRoot, name, resolvedName);
}

/**
 * 独立更新一个已安装的传递依赖（ADR-0072）：写锁与安装记录，但不提升为
 * `.skills.json` 的直接依赖；越出依赖方声明范围只提示。成功后按它自己的
 * 实际版本补齐下游依赖（由 executeInstall 的图落地负责）。
 */
async function updateTransitiveDependency(
  name: string,
  entry: InstallManifestSkill,
  context: UpdateContext
): Promise<void> {
  const { dependencyRoot, storeRoot, options, lockJson, results, targetIdentities } = context;
  const instanceId = entry.instanceId;
  const currentVersion = findLockEntry(lockJson, name, instanceId)?.entry.version ?? entry.version;
  const info = await executeInfo(name, options);
  const resolvedName = info.currentName ?? name;
  targetIdentities.add(resolvedName);
  const latest = highestStableVersion(info.versions ?? []);
  if (!latest) return;
  const needsUpdate = semver.gt(latest, currentVersion);

  if (needsUpdate) {
    const dependents = await findOutOfRangeDependents(dependencyRoot, storeRoot, name, latest);
    if (dependents.length > 0) {
      console.warn(
        `Warning: ${name}@${latest} is outside the range declared by ${dependents.join(', ')}. ` +
          'The update will continue; those dependencies are now advisory.'
      );
    }
    await executeInstall(resolvedName, {
      ...options,
      projectRoot: dependencyRoot,
      version: latest,
      instanceId,
      noAdapt: true,
      asTransitive: true
    });
  }

  if (resolvedName !== name) {
    await migrateRenamedInstall({
      name,
      resolvedName,
      instanceId,
      options,
      dependencyRoot,
      storeRoot,
      needsUpdate
    });
    context.didUpdate = true;
    results.push({
      name: resolvedName,
      from: currentVersion,
      to: needsUpdate ? latest : currentVersion
    });
    return;
  }

  if (needsUpdate) {
    context.didUpdate = true;
    results.push({ name: resolvedName, from: currentVersion, to: latest });
  }
}

export async function executeUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
  // update 只升级版本；工具选择归 install/link，已记录 link 的修复由 update 自动维护（ADR-0059）。
  if ('tools' in options || 'force' in options) {
    throw new Error(
      'esl skill update no longer accepts --tools or --force; tool selection belongs to esl skill install / esl link'
    );
  }
  const dependencyRoot = options.global ? resolveLocalStorePaths(options).root : options.projectRoot ?? options.cwd ?? process.cwd();
  await assertNotNestedConsumerStore({
    command: 'update',
    global: options.global,
    projectRoot: dependencyRoot,
    cwd: options.cwd
  });
  const storeRoot = options.global ? dependencyRoot : resolveProjectStorePaths(dependencyRoot).root;
  const skillsJson = await loadSkillsJson(dependencyRoot);
  const lockJson = await loadSkillsLock(dependencyRoot);
  const results: UpdateResultEntry[] = [];
  const targetIdentities = new Set<string>();
  let didUpdate = false;
  const installManifest = await loadInstallManifest(storeRoot);

  // 指定目标既可能是直接依赖，也可能是自动安装的传递依赖（#161）。
  const directTarget = options.skillName === undefined || Object.hasOwn(skillsJson.skills, options.skillName);
  let transitiveTarget: InstallManifestSkill | undefined;
  if (!directTarget && options.skillName) {
    const found = findInstalledSkill(installManifest, options.skillName, options.instanceId);
    if (!found) {
      throw new Error(
        `Skill ${options.skillName} is not installed; use \`esl skill list\` to see installed skills`
      );
    }
    transitiveTarget = found.entry;
  }

  const directRegistrySkills = Object.entries(skillsJson.skills).some(
    ([name, specifier]) =>
      (!options.skillName || options.skillName === name) &&
      !specifier.startsWith('file:') &&
      !specifier.startsWith('link:') &&
      !specifier.startsWith(BUILTIN_SPECIFIER_PREFIX)
  );
  const needsRegistryLogin = directRegistrySkills || transitiveTarget?.source === 'registry';
  if (needsRegistryLogin) {
    await requireFreshToken(options);
  }

  if (transitiveTarget && options.skillName) {
    if (transitiveTarget.source !== 'registry') {
      throw new Error(
        `Skill ${options.skillName} is ${transitiveTarget.source === 'link' ? 'a Skill Source Link' : `a ${transitiveTarget.source} skill`}; ` +
          'only automatically installed registry dependencies can be updated independently'
      );
    }
    const context: UpdateContext = {
      dependencyRoot,
      storeRoot,
      options,
      lockJson,
      results,
      targetIdentities,
      didUpdate: false
    };
    await updateTransitiveDependency(options.skillName, transitiveTarget, context);
    didUpdate = context.didUpdate;
  } else {
    for (const [name, specifier] of Object.entries(skillsJson.skills)) {
      if (options.skillName && options.skillName !== name) {
        continue;
      }
      const instanceId = skillsJson.instances?.[name];

      const currentManifest = await loadInstallManifest(storeRoot);
      const installedEntry = findInstalledSkill(currentManifest, name, instanceId)?.entry;
      if (installedEntry?.source === 'link' || specifier.startsWith('link:')) {
        results.push({ name, from: 'link', to: 'linked (skipped)', skipped: 'link' });
        continue;
      }

      if (specifier.startsWith(BUILTIN_SPECIFIER_PREFIX) || isBuiltinIdentity(name)) {
        targetIdentities.add(name);
        const currentVersion = findLockEntry(lockJson, name, instanceId)?.entry.version;
        const builtin = await loadBuiltinPackageOrThrow(options.builtinDir ?? resolveBuiltinDir(), name);
        if (name !== BUILTIN_IDENTITY && currentVersion && semver.lt(builtin.version, currentVersion)) {
          throw new Error(`Cannot downgrade ${name} from ${currentVersion} to bundled version ${builtin.version}; use a CLI carrying a newer skill version`);
        }
        const targetDir = await executeInstall(name, {
          ...options,
          projectRoot: dependencyRoot,
          noAdapt: true
        });
        const validation = await validateSkillDirectory(targetDir);
        const to = validation.success ? validation.data.skillJson.version : 'builtin';
        if (currentVersion !== to) {
          didUpdate = true;
          results.push({ name, from: currentVersion ?? 'builtin', to });
        }
        continue;
      }

      if (specifier.startsWith('file:')) {
        targetIdentities.add(name);
        const targetDir = await executeInstall(specifier.slice('file:'.length), {
          ...options,
          projectRoot: dependencyRoot,
          noAdapt: true
        });
        const validation = await validateSkillDirectory(targetDir);
        didUpdate = true;
        results.push({
          name,
          from: findLockEntry(lockJson, name, instanceId)?.entry.version ?? 'local',
          to: validation.success ? validation.data.skillJson.version : 'local'
        });
        continue;
      }

      try {
        const info = await executeInfo(name, options);
        const resolvedName = info.currentName ?? name;
        targetIdentities.add(resolvedName);
        const latestVersion = highestStableVersion(info.versions ?? []);
        if (!latestVersion) {
          continue;
        }

        const currentVersion = findLockEntry(lockJson, name, instanceId)?.entry.version;
        // An update only ever moves forward: a lower version published later must
        // not pull an installed skill backwards.
        const needsUpdate = !currentVersion || semver.gt(latestVersion, currentVersion);

        if (needsUpdate) {
          const dependents = await findOutOfRangeDependents(dependencyRoot, storeRoot, name, latestVersion);
          if (dependents.length > 0) {
            console.warn(
              `Warning: ${name}@${latestVersion} is outside the range declared by ${dependents.join(', ')}. ` +
                'The update will continue; those dependencies are now advisory.'
            );
          }
          await executeInstall(resolvedName, {
            ...options,
            projectRoot: dependencyRoot,
            version: latestVersion,
            instanceId,
            noAdapt: true
          });
          didUpdate = true;
        }

        if (resolvedName !== name) {
          await migrateRenamedInstall({
            name,
            resolvedName,
            instanceId,
            options,
            dependencyRoot,
            storeRoot,
            needsUpdate
          });
          didUpdate = true;
          results.push({
            name: resolvedName,
            from: currentVersion ?? 'unknown',
            to: needsUpdate ? latestVersion : (currentVersion ?? latestVersion)
          });
          continue;
        }

        if (!needsUpdate) {
          continue;
        }

        results.push({
          name: resolvedName,
          from: currentVersion ?? 'unknown',
          to: latestVersion
        });
      } catch (error) {
        if (isBlockingNetworkConfigurationError(error)) {
          throw error;
        }
        console.error(`Failed to update ${name}: ${(error as Error).message}`);
      }
    }
  }

  // 升级后自动维护已记录的 Tool Link（承接原 `tools sync` 的修复职责，ADR-0059）：
  // 缺失或 ESL 自己的错链重建，被非 ESL 内容占用的目标报告冲突且不覆盖。
  if (targetIdentities.size > 0) {
    const repairs = await repairRecordedToolLinks({
      storeRoot,
      level: options.global ? 'global' : 'project',
      projectRoot: dependencyRoot,
      homeDir: options.homeDir,
      identities: targetIdentities
    });
    const issues = repairs.filter(
      (entry) => entry.status === 'conflict' || entry.status === 'failed'
    );
    if (issues.length > 0) {
      throw new Error(
        `Tool link issue: ${issues
          .map((entry) => `${entry.tool} (${entry.identity}: ${entry.status}${entry.error ? `: ${entry.error}` : ''})`)
          .join(', ')}`
      );
    }
  }

  // 只有本次确实改动了安装内容，或用户/Agent 已带回清理答案时才提供清理选择；
  // 单纯检查是否最新不会冒出无关的孤儿候选。
  if (!didUpdate && !options.cleanupProvided) {
    return results;
  }

  // 更新后不再需要的旧依赖：列出候选，默认全部保留；只有用户选择才删除。
  // 保留意图跨命令持久有效，不再有隐式孤立回收（ADR-0072）。
  const cleanupPlan = await computeCleanupPlan({ dependencyRoot, storeRoot });
  const candidates = cleanupPlan.candidates;
  const decision = await resolveDependencyCleanup({
    command: 'update',
    candidates,
    protectedDependents: cleanupPlan.protectedDependents,
    cleanup: options.cleanup,
    cleanupProvided: options.cleanupProvided ?? options.cleanup !== undefined,
    agentMode: options.agentMode,
    interactive: options.interactive,
    selectCleanup: options.selectCleanup
  });

  const manifest = await loadInstallManifest(storeRoot);
  for (const identity of decision.selected) {
    const candidate = candidates.find((item) => item.identity === identity);
    const entry = findInstalledSkill(manifest, identity, candidate?.instanceId)?.entry;
    if (!entry) continue;
    await removeInstalledIdentity(identity, entry, {
      storeRoot,
      dependencyRoot,
      level: options.global ? 'global' : 'project',
      projectRoot: dependencyRoot,
      homeDir: options.homeDir
    });
    notify(`Removed unused dependency: ${identity}`);
  }
  if (decision.persistRetention) {
    await persistRetainedCandidates(storeRoot, candidates, decision.retained);
  }
  if (decision.retained.length > 0) {
    notify(
      `Kept dependencies: ${decision.retained.join(', ')}.` +
        (decision.persistRetention ? ' They are marked as retained and will not be reclaimed automatically.' : '')
    );
  }

  return results;
}
