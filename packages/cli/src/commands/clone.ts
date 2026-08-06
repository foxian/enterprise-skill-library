import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseSkillName } from '@esl/core';
import {
  authenticatedGitUrl,
  requireConfigured,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';

const defaultExecFileAsync = promisify(execFile);

export interface CloneOptions extends NetworkCommandOptions {
  target?: string;
  cwd?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

export async function executeClone(name: string, options: CloneOptions = {}): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
  const info = await executeInfo(name, options);
  const repoPath = requireConfigured(info.gitRepoPath, 'gitRepoPath');
  const remoteUrl = authenticatedGitUrl(gitHttpBase, authToken, repoPath);

  const { skillName } = parseSkillName(name);
  const cwd = options.cwd ?? process.cwd();
  const targetDir = options.target ?? path.join(cwd, skillName);

  await execFileAsync('git', ['clone', remoteUrl, targetDir]);

  return targetDir;
}
