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
  removeDirectory,
  validateSkillDirectory
} from '@esl/core';
import {
  authenticatedGitUrl,
  installTargetDir,
  projectSkillsDir,
  requireConfigured,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';

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
  const validation = await validateSkillDirectory(resolved);
  if (!validation.success) {
    throw new Error(`Invalid skill package at ${resolved}: ${validation.errors.join(', ')}`);
  }

  const { skillJson } = validation.data;
  const targetDir = projectSkillsDir(projectRoot, skillJson.name);
  await copySkillDirectory(resolved, targetDir);
  await addSkillDependency(projectRoot, skillJson.name, `file:${resolved}`);

  return targetDir;
}

async function installFromServer(
  name: string,
  projectRoot: string | null,
  options: InstallOptions
): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
  const info = await executeInfo(name, options);
  const repoPath = requireConfigured(info.gitRepoPath, 'gitRepoPath');
  const remoteUrl = authenticatedGitUrl(gitHttpBase, authToken, repoPath);
  const version = options.version ?? info.versions?.[0];

  if (options.global || !projectRoot) {
    const targetDir = path.normalize(installTargetDir(name, options));
    await removeDirectory(targetDir);
    await execFileAsync('git', ['clone', remoteUrl, targetDir]);
    if (version) {
      await execFileAsync('git', ['checkout', version], { cwd: targetDir });
    }
    return targetDir;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-install-'));
  try {
    const cloneDir = path.join(tmpDir, 'repo');
    await execFileAsync('git', ['clone', remoteUrl, cloneDir]);
    if (version) {
      await execFileAsync('git', ['checkout', version], { cwd: cloneDir });
    }

    const targetDir = projectSkillsDir(projectRoot, name);
    await copySkillDirectory(cloneDir, targetDir);
    await addSkillDependency(projectRoot, name, version ? `^${version}` : '^0.0.0');
    if (version) {
      await addLockEntry(projectRoot, name, {
        version,
        resolved: repoPath,
        integrity: ''
      });
    }

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
