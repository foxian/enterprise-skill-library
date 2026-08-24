import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateSkillDirectory, parseSkillName } from '@esl/core';
import {
  apiUrl,
  fetchWithTimeout,
  gitAuthHeaderConfig,
  requireFreshToken,
  type NetworkCommandOptions
} from './network-options.js';

const defaultExecFileAsync = promisify(execFile);

export interface UploadOptions extends NetworkCommandOptions {
  directory?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

export interface UploadedSkill {
  name: string;
  skillId: string;
  cloneUrl: string;
  status?: string;
}

export async function executeUpload(options: UploadOptions = {}): Promise<UploadedSkill> {
  const directory = options.directory ?? process.cwd();
  const validation = await validateSkillDirectory(directory);
  if (!validation.success) {
    throw new Error(`Invalid skill package: ${validation.errors.join(', ')}`);
  }

  const { skillJson } = validation.data;
  const { skillName } = parseSkillName(skillJson.name);
  const authToken = await requireFreshToken(options);
  const server = options.server;
  if (!server) {
    throw new Error('Missing server; run esl login or pass --server');
  }
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/skills/upload'), {
    method: 'POST',
    headers: {
      Authorization: `token ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: skillName,
      description: skillJson.description
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to upload skill source: ${await response.text()}`);
  }

  const uploaded = (await response.json()) as UploadedSkill;
  if (!uploaded.cloneUrl || !uploaded.skillId || !uploaded.name) {
    throw new Error('Failed to upload skill source: API response is incomplete');
  }

  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authHeader = gitAuthHeaderConfig(authToken);
  await ensureEslRemote(execFileAsync, directory, uploaded.cloneUrl);
  await execFileAsync('git', ['-c', authHeader, 'push', 'esl', 'HEAD:main'], { cwd: directory });
  return uploaded;
}

async function ensureEslRemote(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  cloneUrl: string
): Promise<void> {
  try {
    await execFileAsync('git', ['remote', 'add', 'esl', cloneUrl], { cwd: directory });
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (!message.includes('remote esl already exists') && !message.includes('remote `esl` already exists')) {
      throw error;
    }
    throw new Error('Skill source already has an esl remote; use source and Git push to update it');
  }
}
