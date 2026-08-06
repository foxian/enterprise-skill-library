import { adaptProject, loadSkillsJson, loadSkillsLock } from '@esl/core';
import { executeInfo } from './info.js';
import { executeInstall } from './install.js';
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
  const projectRoot = options.projectRoot ?? process.cwd();
  const skillsJson = await loadSkillsJson(projectRoot);
  const lockJson = await loadSkillsLock(projectRoot);
  const results: UpdateResultEntry[] = [];

  for (const [name, specifier] of Object.entries(skillsJson.skills)) {
    if (specifier.startsWith('file:')) {
      continue;
    }

    if (options.skillName && options.skillName !== name) {
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
        projectRoot,
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
    await adaptProject(projectRoot, { homeDir: options.homeDir });
  }

  return results;
}
