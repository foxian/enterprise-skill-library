import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
  adaptGlobal,
  adaptProject,
  BUILTIN_SPECIFIER_PREFIX,
  highestStableVersion,
  isBuiltinIdentity,
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
}

export interface UpdateResultEntry {
  name: string;
  from: string;
  to: string;
}

export type UpdateResult = UpdateResultEntry[];

export async function executeUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
  const manifestRoot = options.global ? resolveLocalStorePaths(options).root : options.projectRoot ?? process.cwd();
  const skillsJson = await loadSkillsJson(manifestRoot);
  const lockJson = await loadSkillsLock(manifestRoot);
  const results: UpdateResultEntry[] = [];

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
      const currentVersion = lockJson.skills[name]?.version;
      const targetDir = await executeInstall(name, {
        ...options,
        projectRoot: manifestRoot,
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
      const targetDir = await executeInstall(specifier.slice('file:'.length), {
        ...options,
        projectRoot: manifestRoot,
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
          projectRoot: manifestRoot,
          version: latestVersion,
          noAdapt: true
        });
      }

      if (resolvedName !== name) {
        const oldDirectory = options.global
          ? publishedInstallTargetDir(name, options)
          : publishedProjectSkillsDir(manifestRoot, name);
        const newDirectory = options.global
          ? publishedInstallTargetDir(resolvedName, options)
          : publishedProjectSkillsDir(manifestRoot, resolvedName);
        if (!needsUpdate && await directoryExists(oldDirectory)) {
          await fs.mkdir(path.dirname(newDirectory), { recursive: true });
          await fs.rename(oldDirectory, newDirectory);
        } else {
          await fs.rm(oldDirectory, { recursive: true, force: true });
        }
        await renameSkillState(manifestRoot, name, resolvedName);
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

  if (!options.noAdapt && results.length > 0) {
    if (options.global) {
      await adaptGlobal({ homeDir: options.homeDir });
    } else {
      await adaptProject(manifestRoot, { homeDir: options.homeDir });
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
