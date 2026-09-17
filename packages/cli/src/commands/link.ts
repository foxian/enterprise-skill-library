import fs from 'node:fs/promises';
import path from 'node:path';
import {
  addLockEntry,
  addSkillDependency,
  fileExists,
  linkSkillDirectory,
  loadInstallManifest,
  loadSkillsJson,
  loadSkillsLock,
  parseSkillName,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  saveInstallManifest,
  skillSourceRelativeDir,
  syncToolLinks,
  validateReleaseManifest,
  validateSkillMd,
  type InstallManifestSkill,
  type SkillsLockEntry,
  type ToolName
} from '@esl/core';
import {
  installTargetDir,
  projectSkillsDir,
  type NetworkCommandOptions
} from './network-options.js';
import { resolveDefaultInstallTools } from './install.js';

export interface LinkOptions extends NetworkCommandOptions {
  identity?: string;
  global?: boolean;
  tools?: ToolName[];
  noTools?: boolean;
  force?: boolean;
  projectRoot?: string;
}

interface ResolvedSourceSkill {
  identity: string;
  version: string;
  shortName: string;
}

async function readSourceVersion(directory: string): Promise<string | null> {
  const releasePath = path.join(directory, 'release.json');
  if (!(await fileExists(releasePath))) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(releasePath, 'utf8'));
  } catch {
    throw new Error(`Invalid release.json at ${releasePath}: file must contain valid JSON`);
  }
  const validation = validateReleaseManifest(parsed);
  if (!validation.success) {
    throw new Error(`Invalid release.json at ${releasePath}: ${validation.errors.join(', ')}`);
  }
  return validation.data.version;
}

function completeBareIdentity(shortName: string, requestedIdentity?: string): string {
  if (!requestedIdentity) {
    return `@local/${shortName}`;
  }
  if (requestedIdentity.startsWith('@') && !requestedIdentity.includes('/')) {
    return `@${requestedIdentity.slice(1)}/${shortName}`;
  }
  if (requestedIdentity.startsWith('@')) {
    const { scope, skillName } = parseSkillName(requestedIdentity);
    if (skillName !== shortName) {
      throw new Error(
        `--identity short name must match the skill source: expected ${skillName}, got ${shortName}`
      );
    }
    return `@${scope}/${skillName}`;
  }
  throw new Error('--identity must be a namespace (@namespace) or a full skill identity (@namespace/skill-name)');
}

async function resolveSourceSkill(
  sourceDir: string,
  requestedIdentity?: string
): Promise<ResolvedSourceSkill> {
  const skillMdPath = path.join(sourceDir, 'SKILL.md');
  if (!(await fileExists(skillMdPath))) {
    throw new Error(`Skill source requires SKILL.md: ${sourceDir}`);
  }

  const skillMd = validateSkillMd(await fs.readFile(skillMdPath, 'utf8'));
  if (!skillMd.success) {
    throw new Error(`Invalid SKILL.md at ${skillMdPath}: ${skillMd.errors.join(', ')}`);
  }

  const version = await readSourceVersion(sourceDir);
  const shortName = skillMd.data.name;
  let releaseIdentity: string | null = null;
  if (version !== null) {
    const release = validateReleaseManifest(
      JSON.parse(await fs.readFile(path.join(sourceDir, 'release.json'), 'utf8'))
    );
    if (!release.success) {
      throw new Error(`Invalid release.json: ${release.errors.join(', ')}`);
    }
    releaseIdentity = release.data.name;
  }

  if (releaseIdentity?.includes('/')) {
    if (requestedIdentity && requestedIdentity !== releaseIdentity) {
      throw new Error(
        `release.json declares ${releaseIdentity}; --identity cannot rename a linked skill`
      );
    }
    parseSkillName(releaseIdentity);
    return { identity: releaseIdentity, version: version ?? '0.1.0', shortName };
  }

  const sourceShortName = releaseIdentity ?? shortName;
  if (sourceShortName !== shortName) {
    throw new Error(
      `release.json short name must match SKILL.md: expected ${shortName}, got ${sourceShortName}`
    );
  }
  return {
    identity: completeBareIdentity(shortName, requestedIdentity),
    version: version ?? '0.1.0',
    shortName
  };
}

export async function executeLink(sourcePath: string, options: LinkOptions = {}): Promise<string> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const resolved = path.resolve(sourcePath);
  const source = await resolveSourceSkill(resolved, options.identity);
  const identity = source.identity;

  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global ? storeRoot : projectRoot;
  const targetDir = options.global ? installTargetDir(identity, options) : projectSkillsDir(projectRoot, identity);

  const [installManifest, skillsJson, lockJson] = await Promise.all([
    loadInstallManifest(storeRoot),
    loadSkillsJson(dependencyRoot),
    loadSkillsLock(dependencyRoot)
  ]);
  const previous = {
    manifestEntry: installManifest.skills[identity] as InstallManifestSkill | undefined,
    dependencySpecifier: skillsJson.skills[identity],
    lockEntry: lockJson.skills[identity] as SkillsLockEntry | undefined
  };

  await linkSkillDirectory({
    identity,
    sourceDir: resolved,
    storeRoot,
    force: options.force,
    previous
  });

  const specifier = `link:${resolved}`;
  const lockEntry: SkillsLockEntry = {
    identity,
    version: source.version,
    resolved,
    integrity: '',
    source: 'link'
  };

  await addSkillDependency(dependencyRoot, identity, specifier);
  await addLockEntry(dependencyRoot, identity, lockEntry);
  await recordLinkInstallState(storeRoot, identity, lockEntry, specifier);
  await finishLink(identity, projectRoot, storeRoot, targetDir, options);
  return targetDir;
}


async function recordLinkInstallState(
  storeRoot: string,
  identity: string,
  lockEntry: SkillsLockEntry,
  specifier: string
): Promise<void> {
  const installManifest = await loadInstallManifest(storeRoot);
  const current = installManifest.skills[identity];
  installManifest.skills[identity] = {
    identity,
    version: lockEntry.version,
    resolved: lockEntry.resolved,
    integrity: lockEntry.integrity,
    source: 'link',
    specifier,
    sourceDir: current?.sourceDir ?? skillSourceRelativeDir(identity),
    installedAt: current?.installedAt ?? new Date().toISOString()
  };
  await saveInstallManifest(storeRoot, installManifest);
}

async function syncSelectedTools(
  identity: string,
  projectRoot: string,
  storeRoot: string,
  options: LinkOptions
): Promise<void> {
  if (options.noTools) {
    return;
  }

  const tools = options.tools ?? await resolveDefaultInstallTools(projectRoot, options);
  if (tools.length === 0) {
    return;
  }

  const results = await syncToolLinks({
    storeRoot,
    level: options.global ? 'global' : 'project',
    tools,
    identities: [identity],
    projectRoot,
    homeDir: options.homeDir,
    force: options.force
  });

  const failedLinks = results
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
}

async function finishLink(
  identity: string,
  projectRoot: string,
  storeRoot: string,
  targetDir: string,
  options: LinkOptions
): Promise<string> {
  await syncSelectedTools(identity, projectRoot, storeRoot, options);
  if (!options.global) {
    const { ensureGitignore } = await import('./uninstall.js');
    await ensureGitignore(projectRoot);
  }
  return targetDir;
}

