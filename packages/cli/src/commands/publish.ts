import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isBuiltinIdentity, validateSkillDirectory, validateSkillSourceDirectory } from '@esl/core';
import { confirm, isInteractive } from '../prompt.js';
import {
  apiUrl,
  fetchWithTimeout,
  gitAuthHeaderConfig,
  requireFreshToken,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';

const defaultExecFileAsync = promisify(execFile);

export interface PublishOptions extends NetworkCommandOptions {
  directory?: string;
  version?: string;
  visibility?: string;
  force?: boolean;
  noInput?: boolean;
  confirmInput?: () => Promise<boolean>;
  execFileAsync?: typeof defaultExecFileAsync;
}

export async function executePublish(options: PublishOptions = {}): Promise<unknown> {
  const directory = options.directory ?? process.cwd();
  if (await fileExists(`${directory}/release.json`)) {
    return executeSourceRelease(options, directory);
  }
  const validation = await validateSkillDirectory(directory);
  if (!validation.success) {
    throw new Error(`Invalid skill package: ${validation.errors.join(', ')}`);
  }

  const { skillJson } = validation.data;
  if (isBuiltinIdentity(skillJson.name)) {
    throw new Error('Built-in skills cannot be published; they are bundled with the ESL CLI');
  }
  if (skillJson.name.startsWith('@local/')) {
    throw new Error(
      '@local/* skills use the local namespace and must be renamed to a stable namespace before publishing'
    );
  }

  await confirmPublish(options, skillJson.name, skillJson.version);

  const fetchImpl = options.customFetch ?? fetch;
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const { server } = await resolveNetworkConfig(options);
  const authToken = await requireFreshToken(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/skills'), {
    method: 'POST',
    headers: {
      Authorization: `token ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: skillJson.name,
      version: skillJson.version,
      description: skillJson.description,
      author: skillJson.author,
      visibility: options.visibility ?? 'public'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to publish skill metadata: ${err}`);
  }

  const published = (await res.json()) as { cloneUrl?: string };
  if (!published.cloneUrl) {
    throw new Error('Failed to publish skill metadata: API response did not include cloneUrl');
  }
  const authHeader = gitAuthHeaderConfig(authToken);

  await ensureEslRemote(execFileAsync, directory, published.cloneUrl);
  await execFileAsync('git', ['-c', authHeader, 'push', 'esl', 'HEAD:main'], { cwd: directory });
  await execFileAsync('git', ['tag', skillJson.version], { cwd: directory });
  await execFileAsync('git', ['-c', authHeader, 'push', 'esl', '--tags'], { cwd: directory });

  return published;
}

async function executeSourceRelease(options: PublishOptions, directory: string): Promise<unknown> {
  const version = options.version;
  if (!version) {
    throw new Error('Release version is required; use esl publish <version>');
  }
  const validation = await validateSkillSourceDirectory(directory);
  if (!validation.success) {
    throw new Error(`Invalid skill source: ${validation.errors.join(', ')}`);
  }

  const status = await git(options, directory, ['status', '--porcelain']);
  if (status.trim()) {
    throw new Error('Cannot publish: working tree is not clean');
  }
  const remoteUrl = await git(options, directory, ['remote', 'get-url', 'esl']);
  await confirmPublish(options, inferIdentityFromRemote(remoteUrl), version);
  const head = (await git(options, directory, ['rev-parse', 'HEAD'])).trim();
  const remoteHead = (await git(options, directory, ['rev-parse', 'esl/main'])).trim();
  if (head !== remoteHead) {
    throw new Error('Cannot publish: local HEAD must be pushed and equal to esl/main');
  }
  const identity = inferIdentityFromRemote(remoteUrl);
  const fetchImpl = options.customFetch ?? fetch;
  const { server } = await resolveNetworkConfig(options);
  const authToken = await requireFreshToken(options);
  const response = await fetchWithTimeout(fetchImpl, apiUrl(server, `/api/skills/${encodeURIComponent(identity)}/releases`), {
    method: 'POST',
    headers: {
      Authorization: `token ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      version,
      sourceCommit: head,
      releaseManifest: validation.data.releaseManifest,
      files: await collectSourceFiles(directory)
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to publish Skill Release: ${await response.text()}`);
  }
  return response.json();
}

async function collectSourceFiles(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else {
        files[path.relative(directory, fullPath).replaceAll(path.sep, '/')] = await fs.readFile(fullPath, 'utf8');
      }
    }
  }
  await visit(directory);
  return files;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function git(
  options: PublishOptions,
  directory: string,
  args: string[]
): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const result = await execFileAsync('git', args, { cwd: directory });
  return result.stdout;
}

function inferIdentityFromRemote(remoteUrl: string): string {
  const match = remoteUrl.trim().match(/\/git\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error('Cannot determine Skill Identity from the esl remote URL');
  }
  return `@${match[1]}/${match[2]}`;
}

async function ensureEslRemote(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  cloneUrl: string
): Promise<void> {
  try {
    await execFileAsync('git', ['remote', 'add', 'esl', cloneUrl], { cwd: directory });
  } catch (error) {
    if (!isExistingRemoteError(error)) {
      throw error;
    }
    await execFileAsync('git', ['remote', 'set-url', 'esl', cloneUrl], { cwd: directory });
  }
}

function isExistingRemoteError(error: unknown): boolean {
  const message = (error as Error).message ?? '';
  return message.includes('remote esl already exists') || message.includes('remote `esl` already exists');
}

async function confirmPublish(
  options: PublishOptions,
  name: string,
  version: string
): Promise<void> {
  if (options.force) {
    return;
  }
  if (options.noInput) {
    throw new Error('Publishing requires confirmation; pass --force to skip it');
  }

  const question = `Publish ${name} v${version} to the ESL Server? [y/N] `;
  const confirmFn =
    options.confirmInput ??
    (async () => {
      if (!isInteractive()) {
        throw new Error('Publishing requires confirmation in an interactive terminal; pass --force to skip');
      }
      return confirm(question);
    });

  const confirmed = await confirmFn();
  if (!confirmed) {
    throw new Error('Publish cancelled');
  }
}
