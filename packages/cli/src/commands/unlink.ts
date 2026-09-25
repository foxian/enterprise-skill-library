import path from 'node:path';
import {
  fileExists,
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
import { resolveUnlinkIdentity } from './resolve-unlink-identity.js';

export interface UnlinkOptions extends LocalStoreOptions {
  projectRoot?: string;
  global?: boolean;
  /** 仅用于解析技能目录；默认 process.cwd()。不等于改变项目根语义之外的额外根 */
  cwd?: string;
}

export interface UnlinkResult {
  identity: string;
  targetDir: string;
  sourceDir: string;
  restored: boolean;
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function executeUnlink(
  target: string | undefined,
  options: UnlinkOptions = {}
): Promise<UnlinkResult> {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = options.projectRoot ?? cwd;
  const resolved = await resolveUnlinkIdentity(target, { cwd });
  const name = resolved.identity;

  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global ? storeRoot : projectRoot;
  const targetDir = options.global
    ? installTargetDir(name, options)
    : projectSkillsDir(projectRoot, name);

  const installManifest = await loadInstallManifest(storeRoot);
  const entry = installManifest.skills[name];

  if (resolved.fromDirectory && resolved.skillDir) {
    const pathMatches = Object.entries(installManifest.skills)
      .filter(
        ([, skill]) =>
          skill.source === 'link' &&
          typeof skill.resolved === 'string' &&
          samePath(skill.resolved, resolved.skillDir!)
      )
      .map(([identity]) => identity);
    const mismatched = pathMatches.filter((identity) => identity !== name);
    if (mismatched.length > 0) {
      throw new Error(
        `Skill directory ${resolved.skillDir} is linked as ${pathMatches.join(', ')}, not ${name}; pass the linked @scope/skill-name explicitly`
      );
    }
  }

  if (!entry || entry.source !== 'link') {
    let message = `Skill ${name} is not linked by ESL`;
    if (!options.global && resolved.usedOmitOrDot && resolved.skillDir) {
      const looksLikeSkillDir =
        (await fileExists(path.join(resolved.skillDir, 'release.json'))) ||
        (await fileExists(path.join(resolved.skillDir, 'SKILL.md')));
      if (looksLikeSkillDir) {
        message +=
          '. For a project-level Skill Source Link, run this from the project root as `esl unlink ./relative/path` or pass @identity; if the skill was linked with --global, pass --global';
      }
    }
    throw new Error(message);
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
