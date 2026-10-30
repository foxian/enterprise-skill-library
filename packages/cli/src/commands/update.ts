import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
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
  validateSkillDirectory
} from '@esl/core';
import { executeInfo } from './info.js';
import { executeInstall } from './install.js';
import { resolveBuiltinDir } from '../builtin-dir.js';
import { removeInstalledIdentity } from './uninstall.js';
import { computeRequiredIdentities } from './dependency-graph.js';
import {
  publishedInstallTargetDir,
  publishedProjectSkillsDir,
  requireFreshToken
} from './network-options.js';
import type { NetworkCommandOptions } from './network-options.js';
import { assertNotNestedConsumerStore } from './consumer-project-root.js';

export interface UpdateOptions extends NetworkCommandOptions {
  projectRoot?: string;
  skillName?: string;
  global?: boolean;
  /** 只用于嵌套 Store 拒绝判断；默认 projectRoot / process.cwd()。 */
  cwd?: string;
}

export interface UpdateResultEntry {
  name: string;
  from: string;
  skipped?: 'link';
  to: string;
}

export type UpdateResult = UpdateResultEntry[];

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

  const hasRegistrySkills = Object.entries(skillsJson.skills).some(
    ([name, specifier]) =>
      (!options.skillName || options.skillName === name) &&
      !specifier.startsWith('file:') &&
      !specifier.startsWith('link:') &&
      !specifier.startsWith(BUILTIN_SPECIFIER_PREFIX)
  );
  if (hasRegistrySkills) {
    await requireFreshToken(options);
  }

  for (const [name, specifier] of Object.entries(skillsJson.skills)) {
    if (options.skillName && options.skillName !== name) {
      continue;
    }
    const instanceId = skillsJson.instances?.[name];

    const installManifest = await loadInstallManifest(storeRoot);
    const installedEntry = findInstalledSkill(installManifest, name, instanceId)?.entry;
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
        await executeInstall(resolvedName, {
          ...options,
          projectRoot: dependencyRoot,
          version: latestVersion,
          instanceId,
          noAdapt: true
        });
      }

      if (resolvedName !== name) {
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

  if (targetIdentities.size === 0) {
    return results;
  }

  // 升级后自动维护已记录的 Tool Link（承接原 `tools sync` 的修复职责，ADR-0059）：
  // 缺失或 ESL 自己的错链重建，被非 ESL 内容占用的目标报告冲突且不覆盖。
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

  // 回收更新后不再被任何剩余根需要（直接或经发布依赖图）的旧传递依赖，
  // 与 uninstall 同一套「需要图」规则，不另做 prune。
  const required = await computeRequiredIdentities(dependencyRoot, storeRoot);
  const remainingManifest = await loadInstallManifest(storeRoot);
  for (const [identity, installedEntry] of Object.entries(remainingManifest.skills)) {
    if (required.has(installedEntry.identity ?? identity)) continue;
    await removeInstalledIdentity(installedEntry.identity ?? identity, installedEntry, {
      storeRoot,
      dependencyRoot,
      level: options.global ? 'global' : 'project',
      projectRoot: dependencyRoot,
      homeDir: options.homeDir
    });
  }

  return results;
}

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
