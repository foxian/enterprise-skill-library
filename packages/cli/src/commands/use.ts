import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { removeDirectory } from '@esl/core';
import {
  authenticatedGitUrl,
  requireConfigured,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';

const defaultExecFileAsync = promisify(execFile);

export interface UseOptions extends NetworkCommandOptions {
  version?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

function isLocalPath(nameOrPath: string): boolean {
  return nameOrPath.startsWith('.') || nameOrPath.startsWith('/') || nameOrPath.startsWith('\\') || path.isAbsolute(nameOrPath);
}

async function readSkillMdFromLocal(sourcePath: string): Promise<string> {
  const resolved = path.resolve(sourcePath);
  const skillMdPath = path.join(resolved, 'SKILL.md');
  return fs.readFile(skillMdPath, 'utf8');
}

async function readSkillMdFromServer(name: string, options: UseOptions): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
  const info = await executeInfo(name, options);
  const repoPath = requireConfigured(info.gitRepoPath, 'gitRepoPath');
  const remoteUrl = authenticatedGitUrl(gitHttpBase, authToken, repoPath);
  const version = options.version ?? info.versions?.[0];

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-'));
  try {
    const cloneDir = path.join(tmpDir, 'repo');
    await execFileAsync('git', ['clone', '--depth', '1', remoteUrl, cloneDir]);
    if (version) {
      await execFileAsync('git', ['checkout', version], { cwd: cloneDir });
    }
    return fs.readFile(path.join(cloneDir, 'SKILL.md'), 'utf8');
  } finally {
    await removeDirectory(tmpDir);
  }
}

export async function executeUse(nameOrPath: string, options: UseOptions = {}): Promise<string> {
  return isLocalPath(nameOrPath)
    ? readSkillMdFromLocal(nameOrPath)
    : readSkillMdFromServer(nameOrPath, options);
}
