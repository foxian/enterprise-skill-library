import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import semver from 'semver';
import {
  addLockEntry,
  addSkillDependency,
  loadInstallManifest,
  loadSkillsLock,
  reconcileToolLinks,
  resolveProjectStorePaths,
  type ToolName,
  copySkillDirectory,
  createMinimalSkillManifest,
  evaluateCompatibility,
  fileExists,
  findInstalledSkill,
  findLockEntry,
  findServerInstanceByAddress,
  highestStableVersion,
  highestSatisfyingVersion,
  isBuiltinIdentity,
  loadConfig,
  loadSkillsJson,
  loadBuiltinPackageOrThrow,
  BUILTIN_SPECIFIER_PREFIX,
  readInstalledDependencies,
  recordInstalledSkill,
  removeDirectory,
  resolveLocalStorePaths,
  resolveReleaseGraph,
  ReleaseGraphError,
  releaseGraphErrorStatus,
  skillSourceRelativeDir,
  installManifestKey,
  normalizeServerUrl,
  type ReleaseGraphSource,
  validateReleaseManifest,
  validateSkillDirectory,
  validateSkillMd,
  preparePublishedSkillPackage,
  parsePublishedSkillPackage,
  ensureGitAvailable
} from '@esl/core';
import { ApiError, requireOkResponse } from '../api-error.js';
import {
  installTargetDir,
  gitAuthHeaderConfig,
  apiUrl,
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
  /** 指定来源实例（依赖复现时由 .skills.json/lock 提供）。 */
  instanceId?: string;
  /** 只用于嵌套 Store 拒绝判断；默认 projectRoot / process.cwd()。 */
  cwd?: string;
  execFileAsync?: typeof defaultExecFileAsync;
  /**
   * 作为已装传递依赖更新（ADR-0072）：写锁与安装清单，但不把目标提升成
   * `.skills.json` 的直接依赖。
   */
  asTransitive?: boolean;
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
  let effectiveOptions = options;
  if (options.instanceId) {
    const { resolveInstanceAddress } = await import('./server-registry.js');
    const resolved = await resolveInstanceAddress(options.instanceId, {
      homeDir: options.homeDir,
      customFetch: options.customFetch
    });
    if (resolved) {
      effectiveOptions = { ...options, server: resolved.server };
    }
    // 本机尚未登记该实例地址时不猜地址，沿用当前 Server，随后用响应中的
    // Instance ID 校验；不一致会 fail-closed。
  }
  const authToken = await requireFreshToken(options);
  const info = await executeInfo(name, effectiveOptions);
  const instanceId = options.instanceId ?? info.instanceId;
  if (!instanceId) {
    throw new Error(
      `ESL Server did not return an Instance ID for ${name}. Remote skill sources require an Instance ID for store isolation; ` +
        'upgrade the Server to a version that supports instance identity, or install a built-in/local skill.'
    );
  }
  // 已登记地址返回不同 Instance ID 时 fail-closed：不能用本地登记之外的实例
  // 静默写入 Store/依赖/锁文件。
  try {
    const config = await loadConfig({ homeDir: options.homeDir });
    const serverForCheck =
      effectiveOptions.server ?? (await resolveNetworkConfig(effectiveOptions)).server;
    const binding = findServerInstanceByAddress(
      { instances: config.servers ?? [], selectedInstanceId: config.selectedInstanceId ?? null },
      normalizeServerUrl(serverForCheck)
    );
    if (binding && binding.instance.instanceId !== instanceId) {
      throw new Error(
        `Address ${binding.instance.preferredAddress} is registered to ESL Server instance ${binding.instance.instanceId}, ` +
          `but it now reports ${instanceId}. Refusing to install from a silently rebound source.`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Refusing to install')) {
      throw error;
    }
    // 配置不可读或地址不是 http(s) 时保持既有安装路径；Instance ID 校验仍以
    // info 响应的身份为准。
  }
  if (options.instanceId && info.instanceId && options.instanceId !== info.instanceId) {
    throw new Error(
      `ESL Server at ${effectiveOptions.server ?? 'the configured address'} belongs to instance ${info.instanceId}, ` +
        `not the locked instance ${options.instanceId}; refusing to install from a different source.`
    );
  }
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
      effectiveOptions,
      authToken,
      info.visibility === 'public' ? 'public' : info.visibility === 'private' ? 'private' : undefined,
      // 根包上报用户原始 specifier；未显式给出 --version 时按 latest 上报（#136）。
      options.version ?? 'latest',
      instanceId
    );
  }

  const remoteUrl = requireConfigured(info.cloneUrl, 'cloneUrl');

  // ADR-0053：已发布包走 HTTP 下载不依赖 git；仅 clone 路径 fail-fast 探测。
  await ensureGitAvailable();

  if (options.global || !projectRoot) {
    const globalRoot = resolveLocalStorePaths(options).root;
    const targetDir = path.normalize(installTargetDir(name, options, instanceId));
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
      source: 'registry' as const,
      instanceId
    };
    if (!options.asTransitive) {
      await addSkillDependency(globalRoot, name, specifier, instanceId);
    }
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

    const targetDir = projectSkillsDir(projectRoot, name, instanceId);
    await copySkillDirectory(cloneDir, targetDir);
    if (info.publishedPackage) {
      await preparePublishedSkillPackage(targetDir, name);
    }
    const specifier = `^${version}`;
    const lockEntry = {
      version,
      resolved: remoteUrl,
      integrity: '',
      source: 'registry' as const,
      instanceId
    };
    const storeRoot = resolveProjectStorePaths(projectRoot).root;
    if (!options.asTransitive) {
      await addSkillDependency(projectRoot, name, specifier, instanceId);
    }
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
  files: Record<string, Buffer>;
}

interface PlannedDependency {
  identity: string;
  version: string;
  integrity: string;
  packageUrl: string;
  visibility: Visibility;
  data: ParsedPublishedPackage;
  /** 该版本发布时冻结的子依赖（ADR-0056）。 */
  dependencyLock?: Record<string, LockedDependency>;
}

type Visibility = 'public' | 'private';

/** 一次目录换入的记录：失败回滚时无旧副本则删、有旧副本则移回。 */
export interface PackageSwap {
  targetDir: string;
  previousDir: string | null;
}

/** 包请求附加 `?requested=<specifier>`（#136）：上报用户原始 specifier 或锁定的精确版本。 */
function withRequestedSpecifier(url: string, requested: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}requested=${encodeURIComponent(requested)}`;
}

/** 下载 Published Skill Package：403 统一映射为 releaseDependencyNotVisible。 */
async function downloadPublishedPackage(
  resolvedPackageUrl: string,
  identity: string,
  options: InstallOptions,
  authToken: string,
  requested: string,
  allowLegacyFallback = false
): Promise<{ integrity: string; data: ParsedPublishedPackage; packageUrl: string }> {
  const fetchImpl = options.customFetch ?? fetch;
  let response = await fetchWithTimeout(fetchImpl, withRequestedSpecifier(resolvedPackageUrl, requested), {
    headers: { Authorization: `token ${authToken}` }
  });
  // 冻锁不记录格式；只在 ZIP 不存在时尝试历史 JSON，其他错误不回退。
  if (allowLegacyFallback && response.status === 404) {
    resolvedPackageUrl = resolvedPackageUrl.replace(/\.zip$/, '.json');
    response = await fetchWithTimeout(fetchImpl, withRequestedSpecifier(resolvedPackageUrl, requested), {
      headers: { Authorization: `token ${authToken}` }
    });
  }
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
  const expectedIntegrity = path.basename(new URL(resolvedPackageUrl).pathname).replace(/\.(?:json|zip)$/, '');
  if (expectedIntegrity.startsWith('sha256-') && integrity !== expectedIntegrity) {
    throw new Error(`Published Skill Package checksum does not match Registry metadata: expected ${expectedIntegrity}, got ${integrity}`);
  }
  const parsed = await parsePublishedSkillPackage(packageBytes);
  const data: ParsedPublishedPackage = {
    ...parsed,
    dependencyLock: parsed.dependencyLock as Record<string, LockedDependency> | undefined
  };
  return { integrity, data, packageUrl: resolvedPackageUrl };
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
    await fs.writeFile(destination, content);
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

/**
 * 按根包嵌入的 Release Dependency Lock 递归下载传递依赖（嵌套锁继续展开，
 * 等同「中间技能按其被锁版本自己的 dependencies 继续展开」），并读取各身份
 * 可见性。全程只下载、不写任何盘。
 */
async function planIncomingGraph(
  rootData: ParsedPublishedPackage,
  options: InstallOptions,
  authToken: string
): Promise<{ nodes: Map<string, PlannedDependency> }> {
  const nodes = new Map<string, PlannedDependency>();
  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  const queue: Array<{ identity: string; entry: LockedDependency }> = Object.entries(
    rootData.dependencyLock ?? {}
  ).map(([identity, entry]) => ({ identity, entry }));

  while (queue.length > 0) {
    const { identity, entry } = queue.shift()!;
    if (nodes.has(identity)) continue;
    const node = await downloadPlannedDependency({
      identity,
      version: entry.version,
      archiveUrl: apiUrl(serverUrl, `/api/packages/${entry.skillId}/${entry.version}/${entry.checksum}.zip`),
      options,
      authToken,
      expected: { skillId: entry.skillId, version: entry.version }
    });
    nodes.set(identity, node);
    for (const [dep, depEntry] of Object.entries(node.dependencyLock ?? {})) {
      queue.push({ identity: dep, entry: depEntry });
    }
  }

  // 各身份可见性：Public 根全链 Public 校验消费。
  for (const [identity, node] of nodes) {
    const info = await executeInfo(identity, options);
    node.visibility = info.visibility === 'public' ? 'public' : 'private';
  }
  return { nodes };
}

/** 下载并校验一个传递依赖包（不改盘）。 */
async function downloadPlannedDependency(input: {
  identity: string;
  version: string;
  archiveUrl: string;
  options: InstallOptions;
  authToken: string;
  visibility?: Visibility;
  expected?: { skillId: string; version: string };
}): Promise<PlannedDependency> {
  const { identity, version, archiveUrl, options, authToken, visibility = 'public', expected } = input;
  const { integrity, data, packageUrl } = await downloadPublishedPackage(
    archiveUrl,
    identity,
    options,
    authToken,
    version,
    true
  );
  if (expected && (data.skillId !== expected.skillId || data.version !== expected.version)) {
    throw new Error(`Dependency ${identity} package metadata does not match the frozen lock`);
  }
  await assertPackageCompatible(identity, data, options);
  return {
    identity,
    version,
    integrity,
    packageUrl,
    visibility,
    data,
    dependencyLock: data.dependencyLock
  };
}

/** 下载一个已冻锁的传递依赖（不改盘）。 */
async function downloadLockedDependency(
  identity: string,
  entry: LockedDependency,
  options: InstallOptions,
  authToken: string
): Promise<PlannedDependency> {
  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  return downloadPlannedDependency({
    identity,
    version: entry.version,
    archiveUrl: apiUrl(serverUrl, `/api/packages/${entry.skillId}/${entry.version}/${entry.checksum}.zip`),
    options,
    authToken,
    expected: { skillId: entry.skillId, version: entry.version }
  });
}

/** 已装副本未出现在本轮入图节点时，读取其可见性（Public 根全链校验用）。 */
async function fetchDependencyVisibility(
  identity: string,
  options: InstallOptions
): Promise<Visibility> {
  try {
    const info = await executeInfo(identity, options);
    return info.visibility === 'public' ? 'public' : 'private';
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      throw new ApiError(403, 'dependency not visible', {
        code: 'releaseDependencyNotVisible',
        params: { identity }
      });
    }
    throw error;
  }
}

/**
 * 已装副本声明的范围没有自己的冻结子图时，按 Registry 的发布记录补齐缺失
 * 依赖：取满足范围的最高稳定版，并沿该版本自己的发布冻锁继续展开。
 */
async function resolveMissingDependency(
  identity: string,
  ranges: readonly string[],
  options: InstallOptions,
  authToken: string
): Promise<PlannedDependency> {
  const info = await executeInfo(identity, options);
  if (info.instanceId && options.instanceId && info.instanceId !== options.instanceId) {
    throw new Error(
      `Dependency ${identity} is supplied by ESL Server instance ${info.instanceId}, not the locked instance ${options.instanceId}; refusing to mix sources.`
    );
  }
  const versions = (info.versions ?? []).filter((version) =>
    ranges.every((range) => semver.validRange(range) === null || semver.satisfies(version, range))
  );
  // 消费端范围只作提示：没有同时满足全部声明的稳定版时，退回最高稳定版，
  // 而不是让整次安装失败（ADR-0072）。
  const version = highestStableVersion(versions) ?? highestStableVersion(info.versions ?? []);
  if (!version) {
    throw new ApiError(409, 'no published version satisfies the dependency range', {
      code: 'releaseDependencyNoSatisfyingVersion',
      params: { identity }
    });
  }
  const outside = ranges.filter(
    (range) => semver.validRange(range) !== null && !semver.satisfies(version, range)
  );
  if (outside.length > 0) {
    console.warn(
      `Warning: installing ${identity}@${version}; it does not satisfy the declared range ${outside.join(', ')}.`
    );
  }
  const release = info.releases?.find((entry) => entry.version === version);
  const packageUrl = release?.packageUrl ?? info.packageUrl;
  if (!packageUrl) {
    throw new ApiError(409, 'dependency has no Published Skill Package', {
      code: 'releaseDependencyNoRelease',
      params: { identity }
    });
  }
  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  const resolvedUrl = packageUrl.startsWith('http') ? packageUrl : apiUrl(serverUrl, packageUrl);
  return downloadPlannedDependency({
    identity,
    version,
    archiveUrl: resolvedUrl,
    options,
    authToken,
    visibility: info.visibility === 'public' ? 'public' : 'private'
  });
}

interface ResolvedDependency {
  identity: string;
  version: string;
  dependencies: Record<string, string>;
  existing: boolean;
  visibility: Visibility;
  node?: PlannedDependency;
}

/**
 * 把一批入图传递依赖落地（ADR-0072）：同一实例内已装的共享依赖优先复用，
 * 即使超出新根声明范围也只提示、不替换或降级；缺失项按冻锁或发布记录补齐；
 * 并沿「实际采用版本」自己的依赖声明递归展开，不用未采用版本的子图冒充完整。
 * Public 全链校验与目录换入失败回滚保持原样。传递依赖只进 Skill Dependency
 * Lock 与安装清单，不进 .skills.json。
 */
async function materializeDependencyGraph(input: {
  nodes: Map<string, PlannedDependency>;
  storeRoot: string;
  dependencyRoot: string;
  rootDependencies: Record<string, string>;
  rootVisibility: Visibility | undefined;
  instanceId?: string;
  committed: Array<PackageSwap>;
  options: InstallOptions;
  authToken: string;
}): Promise<string[]> {
  const {
    nodes,
    storeRoot,
    dependencyRoot,
    rootDependencies,
    rootVisibility,
    instanceId,
    committed,
    options,
    authToken
  } = input;

  const existingManifest = await loadInstallManifest(storeRoot);
  const planned = new Map(nodes);
  const resolved = new Map<string, ResolvedDependency>();
  const rangesByIdentity = new Map<string, Set<string>>();
  const inProgress = new Set<string>();

  const accumulateRanges = (identity: string, ranges: readonly string[]): void => {
    let current = rangesByIdentity.get(identity);
    if (!current) {
      current = new Set();
      rangesByIdentity.set(identity, current);
    }
    for (const range of ranges) current.add(range);
  };

  const resolveNode = async (identity: string, ranges: readonly string[], path: string[]): Promise<void> => {
    accumulateRanges(identity, ranges);
    if (resolved.has(identity)) return;
    if (path.includes(identity) || inProgress.has(identity)) {
      throw new ApiError(409, 'dependency graph contains a cycle', {
        code: 'releaseDependencyCycle',
        params: { path: [...path, identity].join(' -> ') }
      });
    }
    inProgress.add(identity);
    try {
      const existing = findInstalledSkill(existingManifest, identity, instanceId)?.entry;
      if (existing) {
        // 消费端复用优先：已装版本无论高于或低于新声明范围都保留不动。
        const node = planned.get(identity);
        const visibility =
          node?.visibility ??
          (rootVisibility === 'public' ? await fetchDependencyVisibility(identity, options) : 'public');
        const dependencies = readInstalledDependencies(
          storeRoot,
          identity,
          existing.instanceId ?? instanceId
        );
        resolved.set(identity, {
          identity,
          version: existing.version,
          dependencies,
          existing: true,
          visibility
        });
        for (const [dependency, range] of Object.entries(dependencies)) {
          await resolveNode(dependency, [range], [...path, identity]);
        }
        return;
      }

      let node = planned.get(identity);
      // 冻锁里的候选版本必须满足实际采用父版本声明的范围；否则它是未采用
      // 版本的子图，不能拿来冒充完整，改按 Registry 重新解析。
      if (
        node &&
        !ranges.every(
          (range) => semver.validRange(range) === null || semver.satisfies(node!.version, range)
        )
      ) {
        node = undefined;
      }
      if (!node) {
        const allRanges = [...(rangesByIdentity.get(identity) ?? ranges)];
        node = await resolveMissingDependency(identity, allRanges, options, authToken);
        planned.set(identity, node);
      }
      const dependencies = node.data.releaseManifest.dependencies ?? {};
      resolved.set(identity, {
        identity,
        version: node.version,
        dependencies,
        existing: false,
        visibility: node.visibility,
        node
      });
      for (const [dependency, range] of Object.entries(dependencies)) {
        const frozen = node.dependencyLock?.[dependency];
        if (frozen && !planned.has(dependency)) {
          planned.set(dependency, await downloadLockedDependency(dependency, frozen, options, authToken));
        }
        await resolveNode(dependency, [range], [...path, identity]);
      }
    } finally {
      inProgress.delete(identity);
    }
  };

  for (const [identity, range] of Object.entries(rootDependencies)) {
    await resolveNode(identity, [range], []);
  }

  // 已装版本与声明范围的差异只诊断，不阻止安装，也不声称已验证兼容。
  for (const [identity, ranges] of rangesByIdentity) {
    const node = resolved.get(identity);
    if (!node?.existing) continue;
    const outside = [...ranges].filter(
      (range) => semver.validRange(range) !== null && !semver.satisfies(node.version, range)
    );
    if (outside.length > 0) {
      console.warn(
        `Warning: reusing installed ${identity}@${node.version}; it does not satisfy the declared range ` +
          `${outside.join(', ')}. The installed copy was kept without being replaced or downgraded.`
      );
    }
  }

  if (rootVisibility === 'public') {
    for (const node of resolved.values()) {
      if (node.visibility !== 'public') {
        throw new ApiError(409, 'public chain has private node', {
          code: 'releaseDependencyPublicChainMustBePublic',
          params: { identity: node.identity }
        });
      }
    }
  }

  const actions = [...resolved.values()]
    .filter((node) => !node.existing && node.node)
    .map((node) => ({ node: node.node!, targetVersion: node.version }));

  for (const action of actions) {
    const dependencyTargetDir = path.join(
      storeRoot,
      skillSourceRelativeDir(action.node.identity, instanceId)
    );
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
      source: 'registry' as const,
      ...(instanceId ? { instanceId } : {})
    };
    await addLockEntry(dependencyRoot, action.node.identity, lockEntry);
    await recordInstalledSkill(storeRoot, action.node.identity, lockEntry, specifier);
  }
  // 复用的已装副本：若锁记录与解析出的实际版本不一致（或缺失），按安装
  // 记录同步，保证声明、锁与实际安装状态各自真实（ADR-0072）。
  const lockJson = await loadSkillsLock(dependencyRoot);
  for (const node of resolved.values()) {
    if (!node.existing) continue;
    const found = findLockEntry(lockJson, node.identity, instanceId);
    if (found?.entry.version === node.version) continue;
    const entry = findInstalledSkill(existingManifest, node.identity, instanceId)?.entry;
    if (!entry?.resolved) continue;
    await addLockEntry(dependencyRoot, node.identity, {
      skillId: entry.skillId,
      identity: node.identity,
      version: node.version,
      resolved: entry.resolved,
      integrity: entry.integrity ?? '',
      source: entry.source,
      ...(entry.instanceId ? { instanceId: entry.instanceId } : {})
    });
  }

  // 返回本轮实际落地（新装）的身份，供 link 为它们建 Tool Link。
  return actions.map((action) => action.node.identity);
}

/** 本地源按即将发布的规则解析已发布依赖：数据源直接读 Registry，并记录各身份可见性。 */
function createHttpGraphSource(
  options: InstallOptions,
  visibility: Map<string, Visibility>,
  instanceIds: Map<string, string>
): ReleaseGraphSource {
  return {
    async listVersions(identity) {
      try {
        const info = await executeInfo(identity, options);
        visibility.set(identity, info.visibility === 'public' ? 'public' : 'private');
        if (info.instanceId) {
          instanceIds.set(identity, info.instanceId);
        }
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
      if (info.instanceId) {
        instanceIds.set(identity, info.instanceId);
      }
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
  const instanceIds = new Map<string, string>();
  let lock: Record<string, { skillId: string; version: string; checksum: string }>;
  try {
    lock = await resolveReleaseGraph(dependencies, createHttpGraphSource(options, visibility, instanceIds), {
      rootVisibility
    });
  } catch (error) {
    if (error instanceof ReleaseGraphError) throw releaseGraphErrorToApiError(error);
    throw error;
  }

  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  const nodes = new Map<string, PlannedDependency>();
  for (const [identity, entry] of Object.entries(lock)) {
    nodes.set(
      identity,
      await downloadPlannedDependency({
        identity,
        version: entry.version,
        archiveUrl: apiUrl(serverUrl, `/api/packages/${entry.skillId}/${entry.version}/${entry.checksum}.zip`),
        options,
        authToken,
        visibility: visibility.get(identity) ?? 'public',
        expected: { skillId: entry.skillId, version: entry.version }
      })
    );
  }

  return materializeDependencyGraph({
    nodes,
    storeRoot,
    dependencyRoot,
    rootDependencies: dependencies,
    rootVisibility,
    instanceId: options.instanceId ?? [...instanceIds.values()][0],
    committed,
    options,
    authToken
  });
}

async function installPublishedPackage(
  name: string,
  version: string,
  packageUrl: string,
  projectRoot: string | null,
  options: InstallOptions,
  authToken: string,
  rootVisibility: Visibility | undefined,
  requestedSpecifier: string,
  instanceId: string
): Promise<string> {
  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  const resolvedPackageUrl = packageUrl.startsWith('http') ? packageUrl : apiUrl(serverUrl, packageUrl);
  const { integrity, data: rootData } = await downloadPublishedPackage(
    resolvedPackageUrl,
    name,
    options,
    authToken,
    requestedSpecifier
  );
  await assertPackageCompatible(name, rootData, options);

  const targetDir = options.global || !projectRoot
    ? publishedInstallTargetDir(name, options, instanceId)
    : publishedProjectSkillsDir(projectRoot, name, instanceId);
  const storeRoot = options.global || !projectRoot
    ? resolveLocalStorePaths(options).root
    : resolveProjectStorePaths(projectRoot).root;
  const dependencyRoot = options.global || !projectRoot ? storeRoot : projectRoot;

  // 先下载整图：安装者读不到任一节点、坏包/不兼容在此失败，此时未写任何盘。
  const { nodes } = await planIncomingGraph(rootData, options, authToken);

  // 先根后依赖换包；任一失败回滚本轮已换目录，已有安装保持原状。
  const committed: Array<PackageSwap> = [];
  try {
    committed.push(await stagePackageSwap(name, version, rootData, targetDir));
    await materializeDependencyGraph({
      nodes,
      storeRoot,
      dependencyRoot,
      rootDependencies: rootData.releaseManifest.dependencies ?? {},
      rootVisibility,
      instanceId,
      committed,
      options,
      authToken
    });
    const rootSpecifier = `^${version}`;
    const rootLockEntry = {
      skillId: rootData.skillId,
      identity: name,
      version,
      resolved: resolvedPackageUrl,
      integrity,
      source: 'registry' as const,
      instanceId
    };
    if (!options.asTransitive) {
      await addSkillDependency(dependencyRoot, name, rootSpecifier, instanceId);
    }
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

  // 复现已声明的项目依赖时以 .skills.json 记录的实例为准；普通安装使用当前
  // 选中 Server，不要求用户日常传 --instance-id（ADR-0071）。
  let instanceId = options.instanceId;
  if (!instanceId && !options.global && !isBuiltinIdentity(nameOrPath) && !isLocalPath(nameOrPath)) {
    try {
      const dependencies = await loadSkillsJson(projectRoot);
      instanceId = dependencies.instances?.[nameOrPath];
    } catch {
      // 没有项目依赖文件时保持当前 Server 上下文。
    }
  }

  const targetDir = isBuiltinIdentity(nameOrPath)
    ? await installFromBuiltin(nameOrPath, projectRoot, options)
    : isLocalPath(nameOrPath)
      ? await installFromLocalPath(nameOrPath, projectRoot, options)
      : await installFromServer(nameOrPath, options.global ? null : projectRoot, { ...options, instanceId });

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
      const ensureTargets: Array<{ identity: string; instanceId?: string; prune: boolean }> = [];
      for (const [key, entry] of Object.entries(installManifest.skills)) {
        const identity = entry.identity ?? key;
        const previouslyInstalled = findInstalledSkill(beforeManifest, identity, entry.instanceId)?.entry;
        if (
          path.resolve(storeRoot, entry.sourceDir) === targetPath ||
          !previouslyInstalled
        ) {
          ensureTargets.push({ identity, instanceId: entry.instanceId, prune: true });
        } else if (JSON.stringify(previouslyInstalled) !== JSON.stringify(entry)) {
          ensureTargets.push({ identity, instanceId: entry.instanceId, prune: false });
        }
      }
      // --tools 与交互勾选同为期望 Tool Link 集合（ADR-0054）：补齐集合内、
      // 删除集合外 ESL 管理项；集合内有失败则保留旧项并让命令失败。
      const level = options.global ? 'global' : 'project';
      for (const target of ensureTargets) {
        const reconciliation = await reconcileToolLinks({
          storeRoot,
          level,
          tools,
          identity: target.identity,
          instanceId: target.instanceId,
          projectRoot,
          homeDir: options.homeDir,
          force: options.force,
          prune: target.prune
        });
        for (const removed of reconciliation.removed) {
          notify(`Removed tool link: ${removed.tool} (${target.identity}) -> ${removed.targetDir} [${removed.status}]`);
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
