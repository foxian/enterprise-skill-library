import { adaptGlobal, adaptProject, loadSkillsJson, loadSkillsLock, resolveLocalStorePaths, validateSkillDirectory } from '@esl/core';
import { executeInfo } from './info.js';
import { executeInstall } from './install.js';
import { requireFreshToken } from './network-options.js';
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
      (!options.skillName || options.skillName === name) && !specifier.startsWith('file:')
  );
  if (hasRegistrySkills) {
    await requireFreshToken(options);
  }

  for (const [name, specifier] of Object.entries(skillsJson.skills)) {
    if (options.skillName && options.skillName !== name) {
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
      const latestVersion = info.versions?.[0];
      if (!latestVersion) {
        continue;
      }

      const currentVersion = lockJson.skills[name]?.version;
      if (currentVersion === latestVersion) {
        continue;
      }

      await executeInstall(name, {
        ...options,
        projectRoot: manifestRoot,
        version: latestVersion,
        noAdapt: true
      });

      results.push({
        name,
        from: currentVersion ?? 'unknown',
        to: latestVersion
      });
    } catch (error) {
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
