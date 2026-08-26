import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import {
  addLockEntry,
  addSkillDependency,
  adaptGlobal,
  adaptProject,
  copySkillDirectory,
  evaluateCompatibility,
  isBuiltinIdentity,
  loadBuiltinPackageOrThrow,
  BUILTIN_SPECIFIER_PREFIX,
  prepareSkillImport,
  removeDirectory,
  resolveLocalStorePaths,
  validateSkillDirectory,
  preparePublishedSkillPackage
} from '@esl/core';
import {
  installTargetDir,
  gitAuthHeaderConfig,
  fetchWithTimeout,
  requireConfigured,
  requireFreshToken,
  resolveNetworkConfig,
  projectSkillsDir,
  publishedInstallTargetDir,
  publishedProjectSkillsDir,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';
import { notify } from '../output.js';
import { resolveBuiltinDir } from '../builtin-dir.js';

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
  ignoreCompatibility?: boolean;
  projectRoot?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

function isLocalPath(nameOrPath: string): boolean {
  return nameOrPath.startsWith('.') || nameOrPath.startsWith('/') || nameOrPath.startsWith('\\') || path.isAbsolute(nameOrPath);
}

async function installFromLocalPath(
  sourcePath: string,
  projectRoot: string,
  options: InstallOptions
): Promise<string> {
  const resolved = path.resolve(sourcePath);
  let validation = await validateSkillDirectory(resolved);
  if (!validation.success) {
    try {
      await prepareSkillImport(resolved);
      validation = await validateSkillDirectory(resolved);
    } catch {
      // If implicit import fails, throw original validation error
    }
  }

  if (!validation.success) {
    throw new Error(`Invalid skill package at ${resolved}: ${validation.errors.join(', ')}`);
  }

  const { skillJson } = validation.data;
  const installRoot = options.global ? resolveLocalStorePaths(options).root : projectRoot;
  const targetDir = options.global ? installTargetDir(skillJson.name, options) : projectSkillsDir(projectRoot, skillJson.name);
  await copySkillDirectory(resolved, targetDir);
  await addSkillDependency(installRoot, skillJson.name, `file:${resolved}`);
  await addLockEntry(installRoot, skillJson.name, {
    version: skillJson.version,
    resolved: `file:${resolved}`,
    integrity: ''
  });

  return targetDir;
}

async function installFromBuiltin(
  name: string,
  projectRoot: string,
  options: InstallOptions
): Promise<string> {
  const builtinDir = options.builtinDir ?? resolveBuiltinDir();
  const builtin = await loadBuiltinPackageOrThrow(builtinDir, name);

  const installRoot = options.global ? resolveLocalStorePaths(options).root : projectRoot;
  const targetDir = options.global
    ? installTargetDir(name, options)
    : projectSkillsDir(projectRoot, name);

  await copySkillDirectory(builtin.directory, targetDir);
  await addSkillDependency(installRoot, name, `${BUILTIN_SPECIFIER_PREFIX}${builtin.shortName}`);
  await addLockEntry(installRoot, name, {
    identity: name,
    version: builtin.version,
    resolved: `${BUILTIN_SPECIFIER_PREFIX}${builtin.shortName}`,
    integrity: builtin.checksum,
    source: 'builtin'
  });

  if (options.global && !options.noAdapt) {
    await adaptGlobal({ homeDir: options.homeDir });
  }

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
  const version = options.version ?? info.versions?.[0];
  if (!version) {
    throw new Error(`Skill ${name} has no published Skill Release; use esl source for source access`);
  }

  const requestedPackageUrl = info.releases?.find((release) => release.version === version)?.packageUrl ?? info.packageUrl;
  if (requestedPackageUrl) {
    return installPublishedPackage(name, version, requestedPackageUrl, projectRoot, options, authToken);
  }

  const remoteUrl = requireConfigured(info.cloneUrl, 'cloneUrl');

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
    await addSkillDependency(globalRoot, name, `^${version}`);
    await addLockEntry(globalRoot, name, {
      version,
      resolved: remoteUrl,
      integrity: ''
    });
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
    await addSkillDependency(projectRoot, name, `^${version}`);
    await addLockEntry(projectRoot, name, {
      version,
      resolved: remoteUrl,
      integrity: ''
    });

    return targetDir;
  } finally {
    await removeDirectory(tmpDir);
  }
}

async function installPublishedPackage(
  name: string,
  version: string,
  packageUrl: string,
  projectRoot: string | null,
  options: InstallOptions,
  authToken: string
): Promise<string> {
  const fetchImpl = options.customFetch ?? fetch;
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
  const resolvedPackageUrl = packageUrl.startsWith('http') ? packageUrl : `${await serverUrl}${packageUrl}`;
  const response = await fetchWithTimeout(fetchImpl, resolvedPackageUrl, {
    headers: { Authorization: `token ${authToken}` }
  });
  if (!response.ok) {
    throw new Error(`Failed to download Published Skill Package: ${await response.text()}`);
  }
  const packageBytes = Buffer.from(await response.arrayBuffer());
  const integrity = `sha256-${crypto.createHash('sha256').update(packageBytes).digest('hex')}`;
  const expectedIntegrity = path.basename(new URL(resolvedPackageUrl).pathname).replace(/\.json$/, '');
  if (expectedIntegrity.startsWith('sha256-') && integrity !== expectedIntegrity) {
    throw new Error(`Published Skill Package checksum does not match Registry metadata: expected ${expectedIntegrity}, got ${integrity}`);
  }
  const packageData = JSON.parse(packageBytes.toString('utf8')) as {
    name: string;
    skillId: string;
    version: string;
    sourceCommit: string;
    checksum?: string;
    releaseManifest: Record<string, unknown>;
    dependencyLock?: Record<string, LockedDependency>;
    files: Record<string, string>;
  };
  if (!options.ignoreCompatibility) {
    const compatibility = await evaluateCompatibility(
      packageData.releaseManifest.compatibility ?? {},
      { execFileAsync }
    );
    if (!compatibility.compatible) {
      const reasons = [
        ...compatibility.missingTools.map((tool) => `missing tool ${tool}`),
        ...compatibility.unsupportedLanguages.map((language) => `unsupported language ${language}`)
      ];
      throw new Error(`Published Skill Package is incompatible: ${reasons.join(', ')}`);
    }
  }
  const targetDir = options.global || !projectRoot
    ? publishedInstallTargetDir(name, options)
    : publishedProjectSkillsDir(projectRoot, name);
  const stagingDir = `${targetDir}.staging-${process.pid}-${Date.now()}`;
  await removeDirectory(stagingDir);
  for (const [relativePath, content] of Object.entries(packageData.files ?? {})) {
    const destination = path.join(stagingDir, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, 'utf8');
  }
  if (packageData.version !== version || packageData.name !== name) {
    await removeDirectory(stagingDir);
    throw new Error('Published Skill Package metadata does not match the requested Release');
  }
  const previousDir = `${targetDir}.previous-${process.pid}-${Date.now()}`;
  try {
    await fs.rename(targetDir, previousDir);
  } catch {
    await removeDirectory(previousDir);
  }
  try {
    await fs.rename(stagingDir, targetDir);
  } catch (error) {
    await removeDirectory(stagingDir);
    try {
      await fs.rename(previousDir, targetDir);
    } catch {
    }
    throw error;
  }
  await removeDirectory(previousDir);
  const root = options.global || !projectRoot ? resolveLocalStorePaths(options).root : projectRoot;
  await addSkillDependency(root, name, `^${version}`);
  await addLockEntry(root, name, {
    skillId: packageData.skillId,
    identity: name,
    version,
    resolved: resolvedPackageUrl,
    integrity
  });
  await installPublishedDependencies(
    packageData.dependencyLock ?? {},
    root,
    options,
    authToken,
    new Set([name])
  );
  return targetDir;
}

async function installPublishedDependencies(
  dependencyLock: Record<string, LockedDependency>,
  projectRoot: string,
  options: InstallOptions,
  authToken: string,
  seen: Set<string>
): Promise<void> {
  for (const [dependencyName, dependency] of Object.entries(dependencyLock)) {
    if (seen.has(dependencyName)) continue;
    seen.add(dependencyName);
    const dependencyInfo = await executeInfo(dependencyName, options);
    const dependencyPackageUrl = dependencyInfo.releases?.find((release) => release.version === dependency.version)?.packageUrl ?? dependencyInfo.packageUrl;
    if (!dependencyPackageUrl) {
      throw new Error(`Dependency ${dependencyName} has no published Skill Release`);
    }
    const fetchImpl = options.customFetch ?? fetch;
    const serverUrl = options.server ?? (await resolveNetworkConfig(options)).server;
    const resolvedPackageUrl = dependencyPackageUrl.startsWith('http')
      ? dependencyPackageUrl
      : `${serverUrl}${dependencyPackageUrl}`;
    const response = await fetchWithTimeout(fetchImpl, resolvedPackageUrl, {
      headers: { Authorization: `token ${authToken}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to download dependency Published Skill Package: ${await response.text()}`);
    }
    const packageBytes = Buffer.from(await response.arrayBuffer());
    const integrity = `sha256-${crypto.createHash('sha256').update(packageBytes).digest('hex')}`;
    const expectedIntegrity = path.basename(new URL(resolvedPackageUrl).pathname).replace(/\.json$/, '');
    if (expectedIntegrity.startsWith('sha256-') && integrity !== expectedIntegrity) {
      throw new Error(`Dependency Published Skill Package checksum does not match Registry metadata: expected ${expectedIntegrity}, got ${integrity}`);
    }
    const packageData = JSON.parse(packageBytes.toString('utf8')) as {
      name: string;
      skillId: string;
      version: string;
      sourceCommit: string;
      releaseManifest: { compatibility?: Record<string, unknown> };
      files: Record<string, string>;
      dependencyLock?: Record<string, LockedDependency>;
    };
    if (!options.ignoreCompatibility) {
      const compatibility = await evaluateCompatibility(packageData.releaseManifest.compatibility ?? {}, {
        execFileAsync: options.execFileAsync
      });
      if (!compatibility.compatible) {
        throw new Error(`Dependency ${dependencyName} is incompatible: ${[
          ...compatibility.missingTools.map((tool) => `missing tool ${tool}`),
          ...compatibility.unsupportedLanguages.map((language) => `unsupported language ${language}`)
        ].join(', ')}`);
      }
    }
    const dependencyTargetDir = publishedProjectSkillsDir(projectRoot, dependencyName);
    const dependencyStagingDir = `${dependencyTargetDir}.staging-${process.pid}-${Date.now()}`;
    await removeDirectory(dependencyStagingDir);
    for (const [relativePath, content] of Object.entries(packageData.files ?? {})) {
      const destination = path.join(dependencyStagingDir, relativePath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, content, 'utf8');
    }
    const dependencyPreviousDir = `${dependencyTargetDir}.previous-${process.pid}-${Date.now()}`;
    try {
      await fs.rename(dependencyTargetDir, dependencyPreviousDir);
    } catch {
      await removeDirectory(dependencyPreviousDir);
    }
    try {
      await fs.rename(dependencyStagingDir, dependencyTargetDir);
    } catch (error) {
      await removeDirectory(dependencyStagingDir);
      try {
        await fs.rename(dependencyPreviousDir, dependencyTargetDir);
      } catch {
      }
      throw error;
    }
    await removeDirectory(dependencyPreviousDir);
    await addSkillDependency(projectRoot, dependencyName, `^${dependency.version}`);
    await addLockEntry(projectRoot, dependencyName, {
      skillId: dependency.skillId,
      identity: dependencyName,
      version: dependency.version,
      resolved: resolvedPackageUrl,
      integrity
    });
    await installPublishedDependencies(dependency.dependencyLock ?? {}, projectRoot, options, authToken, seen);
  }
}

export async function executeInstall(nameOrPath: string, options: InstallOptions = {}): Promise<string> {
  const projectRoot = options.projectRoot ?? process.cwd();

  const targetDir = isBuiltinIdentity(nameOrPath)
    ? await installFromBuiltin(nameOrPath, projectRoot, options)
    : isLocalPath(nameOrPath)
      ? await installFromLocalPath(nameOrPath, projectRoot, options)
      : await installFromServer(nameOrPath, options.global ? null : projectRoot, options);

  if (!options.noAdapt && !options.global) {
    await adaptProject(projectRoot, { homeDir: options.homeDir });
  }

  if (!options.global) {
    const { ensureGitignore } = await import('./uninstall.js');
    await ensureGitignore(projectRoot);
  }

  return targetDir;
}
