import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createMinimalReleaseManifest, fileExists, isBuiltinIdentity, validateSkillSourceDirectory } from '@esl/core';
import { confirm, isInteractive, readText } from '../prompt.js';
import {
  apiUrl,
  fetchWithTimeout,
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
  license?: string;
  confirmInput?: () => Promise<boolean>;
  execFileAsync?: typeof defaultExecFileAsync;
}

export async function executePublish(options: PublishOptions = {}): Promise<unknown> {
  const directory = options.directory ?? process.cwd();
  const skillJsonPath = path.join(directory, 'skill.json');
  if (await fileExists(skillJsonPath)) {
    const raw = await fs.readFile(skillJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { name?: string };
    if (parsed.name && isBuiltinIdentity(parsed.name)) {
      throw new Error('Built-in skills cannot be published; they are bundled with the ESL CLI');
    }
  }
  if (!(await fileExists(`${directory}/release.json`))) {
    await ensureReleaseManifest(options, directory);
    throw new Error(
      'Created release.json in the source directory; commit it and push to esl/main, then run esl publish <version> again'
    );
  }
  return executeSourceRelease(options, directory);
}

async function ensureReleaseManifest(options: PublishOptions, directory: string): Promise<void> {
  const license = await resolveLicense(options);
  const releaseJson = createMinimalReleaseManifest(license);
  await fs.writeFile(path.join(directory, 'release.json'), `${JSON.stringify(releaseJson, null, 2)}\n`, 'utf8');
}

async function resolveLicense(options: PublishOptions): Promise<string> {
  if (options.license) {
    return options.license;
  }
  if (options.noInput || !isInteractive()) {
    throw new Error('Missing release.json: a license is required to create release.json; pass --license or run interactively');
  }
  const license = (await readText('Missing release.json. SPDX license for the new manifest: ')).trim();
  if (!license) {
    throw new Error('Missing release.json: a license is required to create release.json');
  }
  return license;
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
  let remoteUrl = '';
  try {
    remoteUrl = await git(options, directory, ['remote', 'get-url', 'esl']);
  } catch {
    throw new Error('Cannot publish: the skill source has no esl remote; run esl upload first');
  }
  const identity = inferIdentityFromRemote(remoteUrl);
  if (identity.startsWith('@local/')) {
    throw new Error('@local/* skills use the local namespace and must be renamed to a stable namespace before publishing');
  }
  await confirmPublish(options, identity, version);
  const head = (await git(options, directory, ['rev-parse', 'HEAD'])).trim();
  const remoteHead = (await git(options, directory, ['rev-parse', 'esl/main'])).trim();
  if (head !== remoteHead) {
    throw new Error('Cannot publish: local HEAD must be pushed and equal to esl/main');
  }
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