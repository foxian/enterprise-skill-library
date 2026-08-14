import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseSkillName } from '@esl/core';
import {
  gitAuthHeaderConfig,
  requireConfigured,
  requireFreshToken,
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
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authToken = await requireFreshToken(options);
  const info = await executeInfo(name, options);
  const remoteUrl = requireConfigured(info.cloneUrl, 'cloneUrl');
  const authHeader = gitAuthHeaderConfig(authToken);

  const { skillName } = parseSkillName(name);
  const cwd = options.cwd ?? process.cwd();
  const targetDir = options.target ?? path.join(cwd, skillName);

  notify(`Cloning ${name}...`);
  await execFileAsync('git', ['-c', authHeader, 'clone', remoteUrl, targetDir]);

  return targetDir;
}
