import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import {
  addLockEntry,
  addSkillDependency,
  chooseMergedVersion,
  loadInstallManifest,
  reconcileToolLinks,
  resolveProjectStorePaths,
  type ToolName,
  copySkillDirectory,
  createMinimalSkillManifest,
  evaluateCompatibility,
  fileExists,
  highestStableVersion,
  isBuiltinIdentity,
  loadSkillsJson,
  loadBuiltinPackageOrThrow,
  BUILTIN_SPECIFIER_PREFIX,
  recordInstalledSkill,
  removeDirectory,
  resolveLocalStorePaths,
  resolveReleaseGraph,
  ReleaseGraphError,
  releaseGraphErrorStatus,
  skillSourceRelativeDir,
  type ReleaseGraphSource,
  validateReleaseManifest,
  validateSkillDirectory,
  validateSkillMd,
  preparePublishedSkillPackage,
  ensureGitAvailable
  } from '@esl/core';
import { ApiError, requireOkResponse } from '../api-error.js';
import {
  installTargetDir,
  gitAuthHeaderConfig,
  fetchWithTimeout,
  requireConfigured,
  requireFreshToken,
  resolveNetworkConfig,
  withAuthGuidanceIfForbidden,
  projectSkillsDir,
  publishedInstallTargetDir,
  publishedProjectSkillsDir,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';
import { notify } from '../output.js';
import { resolveBuiltinDir } from '../builtin-dir.js';
import { assertNotNestedConsumerStore } from './consumer-project-root.js';

const defaultExecFileAsync = promisify(execFile);

interface LockedDependency {
  skillId: string;
  version: string;
  checksum: string;
  dependencyLock?: Record<string, LockedDependency>;
}

export interface InstallOptions extends NetworkCommandOptions {
  version?: string;
  global?: boolean;
  noAdapt?: boolean;
  tools?: ToolName[];
  force?: boolean;
  ignoreCompatibility?: boolean;
  projectRoot?: string;
  /** 只用于嵌套 Store 拒绝判断；默认 projectRoot / process.cwd()。 */
  cwd?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

function isLocalPath(nameOrPath: string): boolean {
  return nameOrPath.startsWith('.') || nameOrPath.startsWith('/') || nameOrPath.startsWith('\\') || path.isAbsolute(nameOrPath);
}

/**
 * A deprecated release stays installable — it just carries a warning for whoever
 * lands on it. Silence would hide that a safer release exists.
 */
function warnIfDeprecated(name: string, version: string, message?: string | null): void {
  if (!message) {
    return;
  }
  console.warn(`Warning: ${name}@${version} is deprecated — ${message}`);
}

/**
 * The version to record for a skill installed from a bare source directory: the
 * Release Manifest's version when the source carries one, and 0.1.0 for a draft
 * directory that has no manifest yet.
 */
async function readSourceVersion(directory: string): Promise<string> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(directory, 'release.json'), 'utf8')) as unknown;
    const validation = validateReleaseManifest(parsed);
    if (validation.success) {
      return validation.data.version;
    }
  } catch {
    // No manifest, or an unreadable one: fall back to the draft version.
  }
  return '0.1.0';
}

/** 本地源 `release.json.dependencies`：无清单或清单不可读时视为空。 */
async function readSourceDependencies(directory: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(directory, 'release.json'), 'utf8')) as unknown;
    const validation = validateReleaseManifest(parsed);
    if (validation.success) {
      return validation.data.dependencies;
    }
  } catch {
    // 无清单或不可读：本地草稿不声明发布依赖。
  }
  return {};
}

async function installFromLocalPath(
  sourcePath: string,
  projectRoot: string,
  options: InstallOptions
): Promise<string> {
  const resolved = path.resolve(sourcePath);
  const skillJsonPath = path.join(resolved, 'skill.json');

  let identity: string;
  let version: string;
  let needsGeneratedSkillJson = false;
  let generatedDescription = '';

  const packageValidation = await validateSkillDirectory(resolved);
  if (packageValidation.success) {
    identity = packageValidation.data.skillJson.name;
    version = packageValidation.data.skillJson.version;
  } else {
    if (await fileExists(skillJsonPath)) {
      throw new Error(`Invalid skill package at ${resolved}: ${packageValidation.errors.join(', ')}`);
    }
    if (!(await fileExists(path.join(resolved, 'SKILL.md')))) {
      throw new Error(`Invalid skill package at ${resolved}: ${packageValidation.errors.join(', ')}`);
    }
    const skillMdValidation = validateSkillMd(await fs.readFile(path.join(resolved, 'SKILL.md'), 'utf8'));
    if (!skillMdValidation.success) {
      throw new Error(`Invalid skill package at ${resolved}: ${skillMdValidation.errors.join(', ')}`);
    }
    identity = `@local/${skillMdValidation.data.name}`;
    version = await readSourceVersion(resolved);
    needsGeneratedSkillJson = true;
    generatedDescription = skillMdValidation.data.description;
  }

  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global ? storeRoot : projectRoot;
  const targetDir = options.global ? installTargetDir(identity, options) : projectSkillsDir(projectRoot, identity);

  // 本地源按即将发布的规则拉已发布依赖：失败不回滚本地根源，但依赖图不留半套。
  const dependencies = await readSourceDependencies(resolved);
  const authToken = Object.keys(dependencies).length > 0 ? await requireFreshToken(options) : undefined;
  const committed: Array<PackageSwap> = [];
  try {
    await copySkillDirectory(resolved, targetDir);
    if (needsGeneratedSkillJson) {
      const author = process.env.USER ?? process.env.USERNAME ?? 'anonymous';
      const skillJson = {
        ...createMinimalSkillManifest({
          name: identity,
          description: generatedDescription,
          author
        }),
        version
      };
      await fs.writeFile(path.join(targetDir, 'skill.json'), `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');
    }
    const specifier = `file:${resolved}`;
    const lockEntry = {
      version,
      resolved: specifier,
      integrity: '',
      source: 'local' as const
    };
    await addSkillDependency(dependencyRoot, identity, specifier);
    await addLockEntry(dependencyRoot, identity, lockEntry);
    await recordInstalledSkill(storeRoot, identity, lockEntry, specifier);
    if (authToken) {
      await installLocalSourceDependencies({
        dependencies,
        storeRoot,
        dependencyRoot,
        rootVisibility: undefined,
        options,
        authToken,
        committed
      });
    }
  } catch (error) {
    await rollbackSwaps(committed);
    throw error;
  }

  return targetDir;
}

async function installFromBuiltin(
  name: string,
  projectRoot: string,
  options: InstallOptions
): Promise<string> {
  const builtinDir = options.builtinDir ?? resolveBuiltinDir();
  const builtin = await loadBuiltinPackageOrThrow(builtinDir, name);

  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global ? storeRoot : projectRoot;
  const targetDir = options.global
    ? installTargetDir(name, options)
    : projectSkillsDir(projectRoot, name);

  await copySkillDirectory(builtin.directory, targetDir);
  const specifier = `${BUILTIN_SPECIFIER_PREFIX}${builtin.shortName}`;
  const lockEntry = {
    identity: name,
    version: builtin.version,
    resolved: specifier,
    integrity: builtin.checksum,
    source: 'builtin' as const
  };
  await addSkillDependency(dependencyRoot, name, specifier);
  await addLockEntry(dependencyRoot, name, lockEntry);
  await recordInstalledSkill(storeRoot, name, lockEntry, specifier);

  return targetDir;
}

async function installFromServer(
  name: string,
  projectRoot: string | null,
  options: InstallOptions
): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authToken = await requireFreshToken(options);
  const info = await executeInfo(name, options);
  const authHeader = gitAuthHeaderConfig(authToken);
  const version = options.version ?? highestStableVersion(info.versions ?? []);
  if (!version) {
    throw new Error(`Skill ${name} has no published Skill Release; use esl source for source access`);
  }

  const requestedRelease = info.releases?.find((release) => release.version === version);
  warnIfDeprecated(name, version, requestedRelease?.deprecatedMessage);
  const requestedPackageUrl = requestedRelease?.packageUrl ?? info.packageUrl;
  if (requestedPackageUrl) {
    return installPublishedPackage(
      name,
      version,
      requestedPackageUrl,
      projectRoot,
      options,
      authToken,
      info.visibility === 'public' ? 'public' : info.visibility === 'private' ? 'private' : undefined
    );
  }

  const remoteUrl = requireConfigured(info.cloneUrl, 'cloneUrl');

  // ADR-0053：已发布包走 HTTP 下载不依赖 git；仅 clone 路径 fail-fast 探测。
  await ensureGitAvailable();

  if (options.global || !projectRoot) {
    const globalRoot = resolveLocalStorePaths(options).root;
    const targetDir = path.normalize(installTargetDir(name, options));
    await removeDirectory(targetDir);
    notify(`Cloning ${name}...`);
    await execFileAsync('git', ['-c', authHeader, 'clone', remoteUrl, targetDir]);
    await execFileAsync('git', ['checkout', version], { cwd: targetDir });
    if (info.publishedPackage) {
      await preparePublishedSkillPackage(targetDir, name);
    }
    const specifier = `^${version}`;
    const lockEntry = {
      version,
      resolved: remoteUrl,
      integrity: '',
      source: 'registry' as const
    };
    await addSkillDependency(globalRoot, name, specifier);
    await addLockEntry(globalRoot, name, lockEntry);
    await recordInstalledSkill(globalRoot, name, lockEntry, specifier);
    return targetDir;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-install-'));
  try {
    const cloneDir = path.join(tmpDir, 'repo');
    notify(`Cloning ${name}...`);
    await execFileAsync('git', ['-c', authHeader, 'clone', remoteUrl, cloneDir]);
    if (version) {
      await execFileAsync('git', ['checkout', version], { cwd: cloneDir });
    }

    const targetDir = projectSkillsDir(projectRoot, name);
    await copySkillDirectory(cloneDir, targetDir);
    if (info.publishedPackage) {
      await preparePublishedSkillPackage(targetDir, name);
    }
    const specifier = `^${version}`;
    const lockEntry = {
      version,
      resolved: remoteUrl,
      integrity: '',
      source: 'registry' as const
    };
    const storeRoot = resolveProjectStorePaths(projectRoot).root;
    await addSkillDependency(projectRoot, name, specifier);
    await addLockEntry(projectRoot, name, lockEntry);
    await recordInstalledSkill(storeRoot, name, lockEntry, specifier);

    return targetDir;
  } finally {
    await removeDirectory(tmpDir);
  }
}

interface ParsedPublishedPackage {
  name: string;
  skillId: string;
  version: string;
  sourceCommit: string;
  releaseManifest: {
    compatibility?: Record<string, unknown>;
    dependencies?: Record<string, string>;
  };
  dependencyLock?: Record<string, LockedDependency>;
  files: Record<string, string>;
}

interface PlannedDependency {
  identity: string;
  version: string;
  integrity: string;
  packageUrl: string;
  visibility: Visibility;
  data: ParsedPublishedPackage;
}

type Visibility = 'public' | 'private';

/** 一次目录换入的记录：失败回滚时无旧副本则删、有旧副本则移回。 */
export interface PackageSwap {
  targetDir: string;
  previousDir: string | null;
}

/** 下载 Published Skill Package：403 统一映射为 releaseDependencyNotVisible。 */
async function downloadPublishedPackage(
  resolvedPackageUrl: string,
  identity: string,
  options: InstallOptions,
  authToken: string
): Promise<{ integrity: string; data: ParsedPublishedPackage }> {
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(fetchImpl, resolvedPackageUrl, {
    headers: { Authorization: `token ${authToken}` }
  });
  if (!response.ok) {
    if (response.status === 403) {
      throw new ApiError(403, 'dependency not visible', {
        code: 'releaseDependencyNotVisible',
        params: { identity }
      });
    }
    await requireOkResponse(response, 'Failed to download Published Skill Package');
  }
  const packageBytes = Buffer.from(await response.arrayBuffer());
  const integrity = `sha256-${crypto.createHash('sha256').update(packageBytes).digest('hex')}`;
  const expectedIntegrity = path.basename(new URL(resolvedPackageUrl).pathname).replace(/\.json$/, '');
  if (expectedIntegrity.startsWith('sha256-') && integrity !== expectedIntegrity) {
    throw new Error(`Published Skill Package checksum does not match Registry metadata: expected ${expectedIntegrity}, got ${integrity}`);
  }
  return { integrity, data: JSON.parse(packageBytes.toString('utf8')) as ParsedPublishedPackage };
}

async function assertPackageCompatible(
  identity: string,
  data: ParsedPublishedPackage,
  options: InstallOptions
): Promise<void> {
  if (options.ignoreCompatibility) return;
  const compatibility = await evaluateCompatibility(data.releaseManifest.compatibility ?? {}, {
    execFileAsync: options.execFileAsync
  });
  if (!compatibility.compatible) {
    const reasons = [
      ...compatibility.missingTools.map((tool) => `missing tool ${tool}`),
      ...compatibility.unsupportedLanguages.map((language) => `unsupported language ${language}`)
    ];
    throw new Error(`${identity} is incompatible: ${reasons.join(', ')}`);
  }
}

/** 经 staging 把包文件原子换进目标目录，返回记录供失败时回滚。 */
async function stagePackageSwap(
  identity: string,
  version: string,
  data: ParsedPublishedPackage,
  targetDir: string
): Promise<PackageSwap> {
  const stagingDir = `${targetDir}.staging-${process.pid}-${Date.now()}`;
  await removeDirectory(stagingDir);
  for (const [relativePath, content] of Object.entries(data.files ?? {})) {
    const destination = path.join(stagingDir, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, 'utf8');
  }
  if (data.version !== version || data.name !== identity) {
    await removeDirectory(stagingDir);
    throw new Error('Published Skill Package metadata does not match the requested Release');
  }
  const previousDir = `${targetDir}.previous-${process.pid}-${Date.now()}`;
  let hadPrevious = true;
  try {
    await fs.rename(targetDir, previousDir);
  } catch {
    hadPrevious = false;
    await removeDirectory(previousDir);
  }
  try {
    await fs.rename(stagingDir, targetDir);
  } catch (error) {
    await removeDirectory(stagingDir);
    if (hadPrevious) {
      try {
        await fs.rename(previousDir, targetDir);
      } catch {
      }
    }
    throw error;
  }
  return { targetDir, previousDir: hadPrevious ? previousDir : null };
}

/** 回滚已提交的目录换入：无旧副本的新装直接删，有旧副本的移回。 */
export async function rollbackSwaps(
  committed: Array<PackageSwap>
): Promise<void> {
  for (const record of [...committed].reverse()) {
    await removeDirectory(record.targetDir);
    if (record.previousDir) {
      try {
        await fs.rename(record.previousDir, record.targetDir);
      } catch {
      }
    }
  }
}

function addRanges(target: Map<string, Set<string>>, deps: Record<string, string>): void {
  for (const [identity, range] of Object.entries(deps)) {
    let set = target.get(identity);
    if (!set) {
      set = new Set();
      target.set(identity, set);
    }
    set.add(range);
  }
}

/**
 * 按根包嵌入的 Release Dependency Lock 递归下载传递依赖（嵌套锁继续展开，
 * 等同「中间技能按其被锁版本自己的 dependencies 继续展开」），同时收集入图
 * 各方声明范围与各身份可见性。全程只下载、不写任何盘。
 */
async function planIncomingGraph(
  rootData: ParsedPublishedPackage,
  options: InstallOptions,
  authToken: string
): Promise<{ nodes: Map<string, PlannedDependency>; incomingRanges: Map<string, Set<string>> }> {
  const nodes = new Map<string, PlannedDependency>();
  const incomingRanges = new Map<string, Set<string>>();
  addRanges(incomingRanges, rootData.releaseManifest.dependencies ?? {});
  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  const queue: Array<{ identity: string; entry: LockedDependency }> = Object.entries(
    rootData.dependencyLock ?? {}
  ).map(([identity, entry]) => ({ identity, entry }));

  while (queue.length > 0) {
    const { identity, entry } = queue.shift()!;
    if (nodes.has(identity)) continue;
    const packageUrl = `${serverUrl}/api/packages/${entry.skillId}/${entry.version}/${entry.checksum}.json`;
    const { integrity, data } = await downloadPublishedPackage(packageUrl, identity, options, authToken);
    if (data.skillId !== entry.skillId || data.version !== entry.version) {
      throw new Error(`Dependency ${identity} package metadata does not match the frozen lock`);
    }
    await assertPackageCompatible(identity, data, options);
    nodes.set(identity, { identity, version: entry.version, integrity, packageUrl, visibility: 'public', data });
    addRanges(incomingRanges, data.releaseManifest.dependencies ?? {});
    for (const [dep, depEntry] of Object.entries(data.dependencyLock ?? {})) {
      queue.push({ identity: dep, entry: depEntry});
    }
  }

  // 各身份可见性：Public 根全链 Public 校验消费。
  for (const [identity, node] of nodes) {
    const info = await executeInfo(identity, options);
    node.visibility = info.visibility === 'public' ? 'public' : 'private';
  }
  return { nodes, incomingRanges };
}

/** 已装图中各根 Release Manifest 声明的范围集合（从 .skills.json 根沿 skill.json 展开）。 */
async function collectExistingRanges(
  dependencyRoot: string,
  storeRoot: string
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  let skillsJson: { skills: Record<string, string> };
  try {
    skillsJson = await loadSkillsJson(dependencyRoot);
  } catch {
    return result;
  }
  const visited = new Set<string>();
  const walk = (identity: string): void => {
    if (visited.has(identity)) return;
    visited.add(identity);
    let parsed: { dependencies?: Record<string, string> };
    try {
      parsed = JSON.parse(fsSync.readFileSync(
        path.join(storeRoot, skillSourceRelativeDir(identity), 'skill.json'),
        'utf8'
      ));
    } catch {
      return;
    }
    for (const [dep, range] of Object.entries(parsed.dependencies ?? {})) {
      addRanges(result, { [dep]: range });
      walk(dep);
    }
  };
  for (const identity of Object.keys(skillsJson.skills)) walk(identity);
  return result;
}

/**
 * 把一批入图传递依赖落地：Public 全链校验 → 与已装图逐身份合并（更高且仍满足
 * 各方 range 否则冲突）→ 换包 → 写锁与安装清单。失败的目录换入记进 committed，
 * 由调用方统一回滚，保证「不留半套图」。传递依赖只进 Skill Dependency Lock 与
 * 安装清单，不进 .skills.json。
 */
async function materializeDependencyGraph(input: {
  nodes: Map<string, PlannedDependency>;
  incomingRanges: Map<string, Set<string>>;
  storeRoot: string;
  dependencyRoot: string;
  rootVisibility: Visibility | undefined;
  committed: Array<PackageSwap>;
}): Promise<string[]> {
  const { nodes, incomingRanges, storeRoot, dependencyRoot, rootVisibility, committed } = input;

  if (rootVisibility === 'public') {
    for (const node of nodes.values()) {
      if (node.visibility !== 'public') {
        throw new ApiError(409, 'public chain has private node', {
          code: 'releaseDependencyPublicChainMustBePublic',
          params: { identity: node.identity }
        });
      }
    }
  }

  const existingManifest = await loadInstallManifest(storeRoot);
  const existingRanges = await collectExistingRanges(dependencyRoot, storeRoot);
  const actions: Array<{ node: PlannedDependency; targetVersion: string }> = [];
  for (const node of nodes.values()) {
    const existing = existingManifest.skills[node.identity];
    if (existing?.version === node.version) continue;
    if (existing?.version) {
      const ranges = [
        ...new Set([
          ...(existingRanges.get(node.identity) ?? []),
          ...(incomingRanges.get(node.identity) ?? [])
        ])
      ];
      const decision = chooseMergedVersion({
        existingVersion: existing.version,
        incomingVersion: node.version,
        ranges
      });
      if ('conflict' in decision) {
        throw new ApiError(409, 'ranges conflict', {
          code: 'installedDependencyRangesConflict',
          params: { identity: node.identity }
        });
      }
      if (decision.version === existing.version) continue; // 已装更高且仍满足：保留不动
      actions.push({ node, targetVersion: decision.version });
    } else {
      actions.push({ node, targetVersion: node.version });
    }
  }

  for (const action of actions) {
    const dependencyTargetDir = path.join(storeRoot, skillSourceRelativeDir(action.node.identity));
    committed.push(await stagePackageSwap(
      action.node.identity,
      action.targetVersion,
      action.node.data,
      dependencyTargetDir
    ));
  }
  for (const action of actions) {
    const specifier = `^${action.targetVersion}`;
    const lockEntry = {
      skillId: action.node.data.skillId,
      identity: action.node.identity,
      version: action.targetVersion,
      resolved: action.node.packageUrl,
      integrity: action.node.integrity,
      source: 'registry' as const
    };
    await addLockEntry(dependencyRoot, action.node.identity, lockEntry);
    await recordInstalledSkill(storeRoot, action.node.identity, lockEntry, specifier);
  }
  // 返回本轮实际落地（新装或升版）的身份，供 link 为它们建 Tool Link。
  return actions.map((action) => action.node.identity);
}

/** 本地源按即将发布的规则解析已发布依赖：数据源直接读 Registry，并记录各身份可见性。 */
function createHttpGraphSource(
  options: InstallOptions,
  visibility: Map<string, Visibility>
): ReleaseGraphSource {
  return {
    async listVersions(identity) {
      try {
        const info = await executeInfo(identity, options);
        visibility.set(identity, info.visibility === 'public' ? 'public' : 'private');
        return info.versions ?? [];
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          throw new ReleaseGraphError('releaseDependencyNotVisible', { identity });
        }
        if (error instanceof ApiError && error.status === 404) {
          return [];
        }
        throw error;
      }
    },
    async load(identity, version) {
      const info = await executeInfo(identity, options);
      const release = info.releases?.find((entry) => entry.version === version);
      if (!release) {
        throw new ReleaseGraphError('releaseDependencyNoRelease', { identity });
      }
      return {
        identity,
        skillId: release.skillId ?? info.skillId ?? '',
        version,
        checksum: release.checksum,
        visibility: info.visibility === 'public' ? 'public' : 'private',
        dependencies: release.releaseManifest?.dependencies ?? {}
      };
    }
  };
}

function releaseGraphErrorToApiError(error: ReleaseGraphError): ApiError {
  return new ApiError(releaseGraphErrorStatus(error.code), error.code, {
    code: error.code,
    params: error.errorParams
  });
}

/**
 * 本地源 `install` / `link` 拉取已发布依赖：未冻锁时按与即将发布相同的交集/最高
 * 满足/可见性规则从 Registry 解析整图，下载后与已装图合并落地。真正的 Release
 * Dependency Lock 只在 publish 冻结，这里不写回本地源清单。
 */
export async function installLocalSourceDependencies(input: {
  dependencies: Record<string, string>;
  storeRoot: string;
  dependencyRoot: string;
  rootVisibility: Visibility | undefined;
  options: InstallOptions;
  authToken: string;
  committed: Array<PackageSwap>;
}): Promise<string[]> {
  const { dependencies, storeRoot, dependencyRoot, rootVisibility, options, authToken, committed } = input;
  if (Object.keys(dependencies).length === 0) return [];
  const visibility = new Map<string, Visibility>();
  let lock: Record<string, { skillId: string; version: string; checksum: string }>;
  try {
    lock = await resolveReleaseGraph(dependencies, createHttpGraphSource(options, visibility), {
      rootVisibility
    });
  } catch (error) {
    if (error instanceof ReleaseGraphError) throw releaseGraphErrorToApiError(error);
    throw error;
  }

  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  const nodes = new Map<string, PlannedDependency>();
  const incomingRanges = new Map<string, Set<string>>();
  addRanges(incomingRanges, dependencies);
  for (const [identity, entry] of Object.entries(lock)) {
    const packageUrl = `${serverUrl}/api/packages/${entry.skillId}/${entry.version}/${entry.checksum}.json`;
    const { integrity, data } = await downloadPublishedPackage(packageUrl, identity, options, authToken);
    await assertPackageCompatible(identity, data, options);
    addRanges(incomingRanges, data.releaseManifest.dependencies ?? {});
    nodes.set(identity, {
      identity,
      version: entry.version,
      integrity,
      packageUrl,
      visibility: visibility.get(identity) ?? 'public',
      data
    });
  }

  return materializeDependencyGraph({
    nodes,
    incomingRanges,
    storeRoot,
    dependencyRoot,
    rootVisibility,
    committed
  });
}

async function installPublishedPackage(
  name: string,
  version: string,
  packageUrl: string,
  projectRoot: string | null,
  options: InstallOptions,
  authToken: string,
  rootVisibility: Visibility | undefined
): Promise<string> {
  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  const resolvedPackageUrl = packageUrl.startsWith('http') ? packageUrl : `${serverUrl}${packageUrl}`;
  const { integrity, data: rootData } = await downloadPublishedPackage(
    resolvedPackageUrl,
    name,
    options,
    authToken
  );
  await assertPackageCompatible(name, rootData, options);

  const targetDir = options.global || !projectRoot
    ? publishedInstallTargetDir(name, options)
    : publishedProjectSkillsDir(projectRoot, name);
  const storeRoot = options.global || !projectRoot
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global || !projectRoot ? storeRoot : projectRoot;

  // 先下载整图：安装者读不到任一节点、坏包/不兼容在此失败，此时未写任何盘。
  const { nodes, incomingRanges } = await planIncomingGraph(rootData, options, authToken);

  // 先根后依赖换包；任一失败回滚本轮已换目录，已有安装保持原状。
  const committed: Array<PackageSwap> = [];
  try {
    committed.push(await stagePackageSwap(name, version, rootData, targetDir));
    await materializeDependencyGraph({
      nodes,
      incomingRanges,
      storeRoot,
      dependencyRoot,
      rootVisibility,
      committed
    });
    const rootSpecifier = `^${version}`;
    const rootLockEntry = {
      skillId: rootData.skillId,
      identity: name,
      version,
      resolved: resolvedPackageUrl,
      integrity,
      source: 'registry' as const
    };
    await addSkillDependency(dependencyRoot, name, rootSpecifier);
    await addLockEntry(dependencyRoot, name, rootLockEntry);
    await recordInstalledSkill(storeRoot, name, rootLockEntry, rootSpecifier);
  } catch (error) {
    await rollbackSwaps(committed);
    throw error;
  }

  return targetDir;
}

export async function executeInstall(nameOrPath: string, options: InstallOptions = {}): Promise<string> {
  const projectRoot = options.projectRoot ?? process.cwd();
  await assertNotNestedConsumerStore({
    command: 'install',
    global: options.global,
    projectRoot,
    cwd: options.cwd
  });
  const failedLinks: string[] = [];
  const storeRoot = options.global
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const beforeManifest = await loadInstallManifest(storeRoot);

  const targetDir = isBuiltinIdentity(nameOrPath)
    ? await installFromBuiltin(nameOrPath, projectRoot, options)
    : isLocalPath(nameOrPath)
      ? await installFromLocalPath(nameOrPath, projectRoot, options)
      : await installFromServer(nameOrPath, options.global ? null : projectRoot, options);

  if (!options.noAdapt) {
    // 工具集必须由调用方显式给出（CLI 走 resolveExpectedTools 的显式/交互/Agent 分支）；
    // 未给出即视为不建 link，绝不回退本机 preferred tools（ADR-0059）。
    const tools = options.tools ?? [];
    if (tools.length > 0) {
      const installManifest = await loadInstallManifest(storeRoot);
      const targetPath = path.resolve(targetDir);
      // 期望集合对账的裁剪只作用于本次安装的主角（被安装技能本身）与本次
      // 新装的依赖；既有技能（仅版本变化）只补缺、绝不裁剪——否则一次无关
      // 的 install 会按本技能的工具期望裁掉用户显式挂在这些技能上的 link。
      const ensureIdentities = new Set<string>();
      const pruneIdentities = new Set<string>();
      for (const [identity, entry] of Object.entries(installManifest.skills)) {
        const previouslyInstalled = beforeManifest.skills[identity];
        if (
          path.resolve(storeRoot, entry.sourceDir) === targetPath ||
          !previouslyInstalled
        ) {
          ensureIdentities.add(identity);
          pruneIdentities.add(identity);
        } else if (JSON.stringify(previouslyInstalled) !== JSON.stringify(entry)) {
          ensureIdentities.add(identity);
        }
      }
      // --tools 与交互勾选同为期望 Tool Link 集合（ADR-0054）：补齐集合内、
      // 删除集合外 ESL 管理项；集合内有失败则保留旧项并让命令失败。
      const level = options.global ? 'global' : 'project';
      for (const identity of ensureIdentities) {
        const reconciliation = await reconcileToolLinks({
          storeRoot,
          level,
          tools,
          identity,
          projectRoot,
          homeDir: options.homeDir,
          force: options.force,
          prune: pruneIdentities.has(identity)
        });
        for (const removed of reconciliation.removed) {
          notify(`Removed tool link: ${removed.tool} (${identity}) -> ${removed.targetDir} [${removed.status}]`);
        }
        failedLinks.push(
          ...reconciliation.failures.map((result) => {
            const detail = 'error' in result && result.error ? `: ${result.error}` : ': conflict';
            return `${result.tool} (${result.targetDir})${detail}`;
          })
        );
      }
    }
  }

  if (!options.global) {
    const { ensureGitignore } = await import('./uninstall.js');
    await ensureGitignore(projectRoot);
  }

  if (failedLinks.length > 0) {
    throw new Error(`Tool link failed; existing content was not overwritten: ${failedLinks.join(', ')}`);
  }

  return targetDir;
}
