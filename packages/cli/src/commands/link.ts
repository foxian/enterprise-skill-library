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
  reconcileToolLinks,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  saveInstallManifest,
  skillSourceRelativeDir,
  validateReleaseManifest,
  validateSkillMd,
  type InstallManifestSkill,
  type SkillsLockEntry,
  type ToolName
} from '@esl/core';
import {
  installTargetDir,
  projectSkillsDir,
  requireFreshToken,
  type NetworkCommandOptions
} from './network-options.js';
import {
  installLocalSourceDependencies,
  resolveDefaultInstallTools,
  rollbackSwaps
} from './install.js';
import { notify } from '../output.js';

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
  dependencies: Record<string, string>;
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
  let dependencies: Record<string, string> = {};
  if (version !== null) {
    const release = validateReleaseManifest(
      JSON.parse(await fs.readFile(path.join(sourceDir, 'release.json'), 'utf8'))
    );
    if (!release.success) {
      throw new Error(`Invalid release.json: ${release.errors.join(', ')}`);
    }
    releaseIdentity = release.data.name;
    dependencies = release.data.dependencies;
  }

  if (releaseIdentity?.includes('/')) {
    if (requestedIdentity && requestedIdentity !== releaseIdentity) {
      throw new Error(
        `release.json declares ${releaseIdentity}; --identity cannot rename a linked skill`
      );
    }
    parseSkillName(releaseIdentity);
    return { identity: releaseIdentity, version: version ?? '0.1.0', shortName, dependencies };
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
    shortName,
    dependencies
  };
}

/**
 * Resolve the identity a link command would use, without touching the store.
 * Lets the CLI run conversion confirmations before Link Staging happens.
 */
export async function resolveLinkIdentity(
  sourcePath: string,
  requestedIdentity?: string
): Promise<{ identity: string }> {
  const resolved = path.resolve(sourcePath);
  const source = await resolveSourceSkill(resolved, requestedIdentity);
  return { identity: source.identity };
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

  // 开发态也让宿主看到被依赖的已发布基础技能：按即将发布的规则拉已发布依赖，
  // 根源码仍是 Skill Source Link，传递依赖只进 Store/锁/安装清单。
  if (Object.keys(source.dependencies).length > 0) {
    const authToken = await requireFreshToken(options);
    const committed: Array<{ targetDir: string; previousDir: string | null }> = [];
    try {
      await installLocalSourceDependencies({
        dependencies: source.dependencies,
        storeRoot,
        dependencyRoot,
        rootVisibility: undefined,
        options,
        authToken,
        committed
      });
    } catch (error) {
      await rollbackSwaps(committed);
      throw error;
    }
  }

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

  const tools = options.tools ?? await resolveDefaultInstallTools({ homeDir: options.homeDir });
  if (tools.length === 0) {
    return;
  }

  // 期望 Tool Link 集合对账（ADR-0054）：补齐集合内、删除集合外 ESL 管理项。
  const reconciliation = await reconcileToolLinks({
    storeRoot,
    level: options.global ? 'global' : 'project',
    tools,
    identity,
    projectRoot,
    homeDir: options.homeDir,
    force: options.force
  });

  for (const removed of reconciliation.removed) {
    notify(`Removed tool link: ${removed.tool} (${identity}) -> ${removed.targetDir} [${removed.status}]`);
  }

  const failedLinks = reconciliation.failures.map((result) => {
    const detail = 'error' in result && result.error ? `: ${result.error}` : ': conflict';
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

