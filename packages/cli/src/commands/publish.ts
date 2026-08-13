import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateSkillDirectory } from '@esl/core';
import { confirm, isInteractive } from '../prompt.js';
import {
  apiUrl,
  fetchWithTimeout,
  remoteGitUrl,
  requireConfigured,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';

const defaultExecFileAsync = promisify(execFile);

export interface PublishOptions extends NetworkCommandOptions {
  directory?: string;
  visibility?: string;
  force?: boolean;
  noInput?: boolean;
  confirmInput?: () => Promise<boolean>;
  execFileAsync?: typeof defaultExecFileAsync;
}

export async function executePublish(options: PublishOptions = {}): Promise<unknown> {
  const directory = options.directory ?? process.cwd();
  const validation = await validateSkillDirectory(directory);
  if (!validation.success) {
    throw new Error(`Invalid skill package: ${validation.errors.join(', ')}`);
  }

  const { skillJson } = validation.data;
  if (skillJson.name.startsWith('@local/')) {
    throw new Error(
      '@local/* skills use the local namespace and must be renamed to a stable namespace before publishing'
    );
  }

  await confirmPublish(options, skillJson.name, skillJson.version);

  const fetchImpl = options.customFetch ?? fetch;
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const { registry, gitBase, token } = await resolveNetworkConfig(options);
  const authToken = requireConfigured(token, 'token');
  const gitHttpBase = requireConfigured(gitBase, 'git-base');
  const res = await fetchWithTimeout(fetchImpl, apiUrl(registry, '/api/skills'), {
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

  const published = (await res.json()) as { gitRepoPath?: string };
  if (!published.gitRepoPath) {
    throw new Error('Failed to publish skill metadata: API response did not include gitRepoPath');
  }
  const repoPath = published.gitRepoPath;
  const remoteUrl = remoteGitUrl(gitHttpBase, repoPath);
  const authHeader = `Authorization: Bearer ${authToken}`;

  await execFileAsync('git', ['remote', 'add', 'esl', remoteUrl], { cwd: directory });
  await execFileAsync('git', ['-c', `http.extraHeader=${authHeader}`, 'push', 'esl', 'HEAD:main'], { cwd: directory });
  await execFileAsync('git', ['tag', skillJson.version], { cwd: directory });
  await execFileAsync('git', ['-c', `http.extraHeader=${authHeader}`, 'push', 'esl', '--tags'], { cwd: directory });

  return published;
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

  const question = `Publish ${name} v${version} to the registry? [y/N] `;
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
