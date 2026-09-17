import {
  loadInstallManifest,
  loadSkillsJson,
  loadSkillsLock,
  removeInstalledSkill,
  removeLockEntry,
  removeSkillDependency,
  removeToolLinks,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  saveInstallManifest,
  saveSkillsJson,
  saveSkillsLock,
  SUPPORTED_TOOLS,
  unlinkSkillDirectory,
  type LocalStoreOptions
} from '@esl/core';
import { installTargetDir, projectSkillsDir } from './network-options.js';

export interface UnlinkOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
}

export interface UnlinkResult {
  identity: string;
  targetDir: string;
  sourceDir: string;
  restored: boolean;
}

export async function executeUnlink(name: string, options: UnlinkOptions = {}): Promise<UnlinkResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global ? storeRoot : projectRoot;
  const targetDir = options.global
    ? installTargetDir(name, options)
    : projectSkillsDir(projectRoot, name);

  const installManifest = await loadInstallManifest(storeRoot);
  const entry = installManifest.skills[name];
  if (!entry || entry.source !== 'link') {
    throw new Error(`Skill ${name} is not linked by ESL`);
  }
  const sourceDir = entry.resolved;
  if (!sourceDir) {
    throw new Error(`Skill ${name} has no linked source path in the install manifest`);
  }

  const { hasLinkStagingRecord } = await import('@esl/core');
  const hasStaging = await hasLinkStagingRecord(name, storeRoot);
  if (!hasStaging) {
    const removedLinks = await removeToolLinks({
      storeRoot,
      identity: name,
      tools: [...SUPPORTED_TOOLS],
      level: options.global ? 'global' : 'project'
    });
    const conflicts = removedLinks.filter((result) => result.status === 'conflict');
    if (conflicts.length > 0) {
      throw new Error(
        `Tool link conflict; content was not removed: ${conflicts
          .map((result) => `${result.tool} (${result.targetDir})`)
          .join(', ')}`
      );
    }
  }

  const result = await unlinkSkillDirectory(name, storeRoot);
  if (result.restored && result.record) {
    const skillsJson = await loadSkillsJson(dependencyRoot);
    const previousSpecifier = result.record.dependencySpecifier;
    if (previousSpecifier === undefined) {
      delete skillsJson.skills[name];
    } else {
      skillsJson.skills[name] = previousSpecifier;
    }
    await saveSkillsJson(dependencyRoot, skillsJson);

    const lockJson = await loadSkillsLock(dependencyRoot);
    const previousLock = result.record.lockEntry;
    if (previousLock === undefined) {
      delete lockJson.skills[name];
    } else {
      lockJson.skills[name] = previousLock;
    }
    await saveSkillsLock(dependencyRoot, lockJson);

    const restoredManifest = await loadInstallManifest(storeRoot);
    const previousManifest = result.record.manifestEntry;
    if (previousManifest === undefined) {
      delete restoredManifest.skills[name];
    } else {
      restoredManifest.skills[name] = previousManifest;
    }
    await saveInstallManifest(storeRoot, restoredManifest);
  } else {
    await removeSkillDependency(dependencyRoot, name);
    await removeLockEntry(dependencyRoot, name);
    await removeInstalledSkill(storeRoot, name);
  }

  return {
    identity: name,
    targetDir,
    sourceDir,
    restored: result.restored
  };
}

