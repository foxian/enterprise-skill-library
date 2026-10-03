import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
  resolveProjectStorePaths,
  BUILTIN_SPECIFIER_PREFIX,
  highestStableVersion,
  isBuiltinIdentity,
  listToolLinks,
  loadInstallManifest,
  loadSkillsJson,
  loadSkillsLock,
  renameSkillState,
  resolveLocalStorePaths,
  validateSkillDirectory
} from '@esl/core';
import { executeInfo } from './info.js';
import { executeInstall } from './install.js';
import { removeInstalledIdentity } from './uninstall.js';
import { computeRequiredIdentities } from './dependency-graph.js';
import {
  publishedInstallTargetDir,
  publishedProjectSkillsDir,
  requireFreshToken
} from './network-options.js';
import type { NetworkCommandOptions } from './network-options.js';

export interface UpdateOptions extends NetworkCommandOptions {
  projectRoot?: string;
  skillName?: string;
  global?: boolean;
}

export interface UpdateResultEntry {
  name: string;
  from: string;
  skipped?: 'link';
  to: string;
}

export type UpdateResult = UpdateResultEntry[];

export async function executeUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
  // update 只升级版本；工具选择归 install/link，修链归 tools sync（ADR-0054）。
  if ('tools' in options || 'force' in options) {
    throw new Error(
      'esl update no longer accepts --tools or --force; tool selection belongs to install/link and link repair to: esl tools sync'
    );
  }
  const dependencyRoot = options.global ? resolveLocalStorePaths(options).root : options.projectRoot ?? process.cwd();
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

    const installManifest = await loadInstallManifest(storeRoot);
    if (installManifest.skills[name]?.source === 'link' || specifier.startsWith('link:')) {
      results.push({ name, from: 'link', to: 'linked (skipped)', skipped: 'link' });
      continue;
    }

    if (specifier.startsWith(BUILTIN_SPECIFIER_PREFIX) || isBuiltinIdentity(name)) {
      targetIdentities.add(name);
      const currentVersion = lockJson.skills[name]?.version;
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
        from: lockJson.skills[name]?.version ?? 'local',
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

      const currentVersion = lockJson.skills[name]?.version;
      // An update only ever moves forward: a lower version published later must
      // not pull an installed skill backwards.
      const needsUpdate = !currentVersion || semver.gt(latestVersion, currentVersion);

      if (needsUpdate) {
        await executeInstall(resolvedName, {
          ...options,
          projectRoot: dependencyRoot,
          version: latestVersion,
          noAdapt: true
        });
      }

      if (resolvedName !== name) {
        const oldDirectory = options.global
          ? publishedInstallTargetDir(name, options)
          : publishedProjectSkillsDir(dependencyRoot, name);
        const newDirectory = options.global
          ? publishedInstallTargetDir(resolvedName, options)
          : publishedProjectSkillsDir(dependencyRoot, resolvedName);
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

  // 升级后已有正确 Tool Link 自动看到新内容；损坏/冲突的链在此报告而不修复。
  const linkEntries = await listToolLinks({
    storeRoot,
    level: options.global ? 'global' : 'project',
    projectRoot: dependencyRoot,
    homeDir: options.homeDir
  });
  const issues = linkEntries.filter(
    (entry) =>
      targetIdentities.has(entry.identity) &&
      (entry.status === 'broken' || entry.status === 'conflict')
  );
  if (issues.length > 0) {
    throw new Error(
      `Tool link issue: ${issues
        .map((entry) => `${entry.tool} (${entry.identity}: ${entry.status})`)
        .join(', ')}`
    );
  }

  // 回收更新后不再被任何剩余根需要（直接或经发布依赖图）的旧传递依赖，
  // 与 uninstall 同一套「需要图」规则，不另做 prune。
  const required = await computeRequiredIdentities(dependencyRoot, storeRoot);
  const remainingManifest = await loadInstallManifest(storeRoot);
  for (const [identity, installedEntry] of Object.entries(remainingManifest.skills)) {
    if (required.has(identity)) continue;
    await removeInstalledIdentity(identity, installedEntry, {
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
