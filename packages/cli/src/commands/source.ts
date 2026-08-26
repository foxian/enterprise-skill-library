import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseSkillName, isBuiltinIdentity } from '@esl/core';
import {
  gitAuthHeaderConfig,
  fetchWithTimeout,
  requireConfigured,
  requireFreshToken,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';
import { notify } from '../output.js';

const defaultExecFileAsync = promisify(execFile);

export interface SourceOptions extends NetworkCommandOptions {
  target?: string;
  cwd?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

export async function executeSource(name: string, options: SourceOptions = {}): Promise<string> {
  if (isBuiltinIdentity(name)) {
    throw new Error(`Unknown built-in skill: ${name}; built-in skills have no source repository`);
  }
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authToken = await requireFreshToken(options);
  const info = await executeInfo(name, options);
  const { server } = await resolveNetworkConfig(options);
  const fetchImpl = options.customFetch ?? fetch;
  const accessResponse = await fetchWithTimeout(
    fetchImpl,
    `${server.replace(/\/$/, '')}/api/skills/${encodeURIComponent(name)}/source-access`,
    {
      method: 'POST',
      headers: { Authorization: `token ${authToken}` }
    }
  );
  if (!accessResponse.ok) {
    throw new Error(`Failed to authorize source access: ${await accessResponse.text()}`);
  }
  const access = (await accessResponse.json()) as { cloneUrl?: string };
  const remoteUrl = requireConfigured(access.cloneUrl ?? info.cloneUrl, 'cloneUrl');
  const authHeader = gitAuthHeaderConfig(authToken);

  const { skillName } = parseSkillName(name);
  const cwd = options.cwd ?? process.cwd();
  const targetDir = options.target ?? path.join(cwd, skillName);

  notify(`Cloning ${name}...`);
  await execFileAsync('git', ['-c', authHeader, 'clone', remoteUrl, targetDir]);

  return targetDir;
}
