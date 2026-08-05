import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  authenticatedGitUrl,
  installTargetDir,
  requireConfigured,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';

const defaultExecFileAsync = promisify(execFile);

export interface InstallOptions extends NetworkCommandOptions {
  version?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

export async function executeInstall(name: string, options: InstallOptions = {}): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const { gitBase, token } = await resolveNetworkConfig(options);
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const authToken = requireConfigured(token, 'token');
  const info = await executeInfo(name, options);
  const repoPath = requireConfigured(info.gitRepoPath, 'gitRepoPath');
  const targetDir = path.normalize(installTargetDir(name, options));
  const remoteUrl = authenticatedGitUrl(gitHttpBase, authToken, repoPath);

  await execFileAsync('git', ['clone', remoteUrl, targetDir]);
  const version = options.version ?? info.versions?.[0];
  if (version) {
    await execFileAsync('git', ['checkout', version], { cwd: targetDir });
  }

  return targetDir;
}
