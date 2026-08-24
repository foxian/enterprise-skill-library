import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  addLockEntry,
  addSkillDependency,
  adaptProject,
  copySkillDirectory,
  prepareSkillImport,
  removeDirectory,
  resolveLocalStorePaths,
  validateSkillDirectory,
  preparePublishedSkillPackage
} from '@esl/core';
import {
  installTargetDir,
  gitAuthHeaderConfig,
  requireConfigured,
  requireFreshToken,
  projectSkillsDir,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';
import { notify } from '../output.js';

const defaultExecFileAsync = promisify(execFile);

export interface InstallOptions extends NetworkCommandOptions {
  version?: string;
  global?: boolean;
  noAdapt?: boolean;
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

async function installFromServer(
  name: string,
  projectRoot: string | null,
  options: InstallOptions
): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authToken = await requireFreshToken(options);
  const info = await executeInfo(name, options);
  const remoteUrl = requireConfigured(info.cloneUrl, 'cloneUrl');
  const authHeader = gitAuthHeaderConfig(authToken);
  const version = options.version ?? info.versions?.[0];
  if (!version) {
    throw new Error(`Skill ${name} has no published Skill Release; use esl source for source access`);
  }

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

export async function executeInstall(nameOrPath: string, options: InstallOptions = {}): Promise<string> {
  const projectRoot = options.projectRoot ?? process.cwd();

  const targetDir = isLocalPath(nameOrPath)
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
