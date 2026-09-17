import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
  resolveProjectStorePaths,
  syncToolLinks,
  type ToolName,
  BUILTIN_SPECIFIER_PREFIX,
  highestStableVersion,
  isBuiltinIdentity,
  listToolLinks,
  loadSkillsJson,
  loadSkillsLock,
  renameSkillState,
  resolveLocalStorePaths,
  validateSkillDirectory
} from '@esl/core';
import { executeInfo } from './info.js';
import { executeInstall } from './install.js';
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
  noAdapt?: boolean;
  tools?: ToolName[];
  force?: boolean;
}

export interface UpdateResultEntry {
  name: string;
  from: string;
  to: string;
}

export type UpdateResult = UpdateResultEntry[];

export async function executeUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
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
      !specifier.startsWith(BUILTIN_SPECIFIER_PREFIX)
  );
  if (hasRegistrySkills) {
    await requireFreshToken(options);
  }

  for (const [name, specifier] of Object.entries(skillsJson.skills)) {
    if (options.skillName && options.skillName !== name) {
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

  if (options.tools && options.tools.length > 0) {
    const linkResults = await syncToolLinks({
      storeRoot,
      level: options.global ? 'global' : 'project',
      tools: options.tools,
      identities: [...targetIdentities],
      projectRoot: dependencyRoot,
      homeDir: options.homeDir,
      force: options.force
    });
    const failedLinks = linkResults
      .filter((result) => result.status === 'conflict' || result.status === 'failed')
      .map((result) => {
        const detail =
          result.status === 'conflict'
            ? `: ${result.error ?? 'conflict'}`
            : result.error
              ? `: ${result.error}`
              : '';
        return `${result.tool} (${result.targetDir})${detail}`;
      });
    if (failedLinks.length > 0) {
      throw new Error(`Tool link failed; existing content was not overwritten: ${failedLinks.join(', ')}`);
    }
  } else {
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
