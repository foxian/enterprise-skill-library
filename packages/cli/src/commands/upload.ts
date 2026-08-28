import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileExists, isBuiltinIdentity, validateSkillSourceDirectory } from '@esl/core';
import {
  apiUrl,
  fetchWithTimeout,
  gitAuthHeaderConfig,
  requireFreshToken,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { ensureReleaseManifest } from './release-manifest.js';

const defaultExecFileAsync = promisify(execFile);

export interface UploadOptions extends NetworkCommandOptions {
  directory?: string;
  license?: string;
  noInput?: boolean;
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
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const skillJsonPath = path.join(directory, 'skill.json');
  if (await fileExists(skillJsonPath)) {
    const raw = await fs.readFile(skillJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { name?: string };
    if (parsed.name && isBuiltinIdentity(parsed.name)) {
      throw new Error('Built-in skills cannot be uploaded; they are bundled with the ESL CLI');
    }
  }
  if (!(await fileExists(`${directory}/release.json`))) {
    await ensureReleaseManifest(options, directory);
  }
  const sourceValidation = await validateSkillSourceDirectory(directory);
  if (!sourceValidation.success) {
    throw new Error(`Invalid skill source: ${sourceValidation.errors.join(', ')}`);
  }
  await prepareSourceGit(execFileAsync, directory);
  return uploadSource(
    options,
    directory,
    sourceValidation.data.skillMd.name,
    sourceValidation.data.skillMd.description
  );
}

const DEFAULT_GITIGNORE = [
  '# ESL skill upload ignores generated and local-only artifacts',
  '.pytest_cache/',
  '__pycache__/',
  '*.pyc',
  'node_modules/',
  '.DS_Store',
  'dist/',
  'build/',
  '.venv/',
  ''
].join('\n');

async function prepareSourceGit(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string
): Promise<void> {
  // Initialize the repository when the skill directory is not already one.
  try {
    const inside = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: directory });
    if (inside.stdout.trim() !== 'true') {
      await execFileAsync('git', ['init'], { cwd: directory });
    }
  } catch {
    await execFileAsync('git', ['init'], { cwd: directory });
  }

  // Write a base .gitignore when none exists so generated junk stays out of the source.
  const gitignorePath = path.join(directory, '.gitignore');
  if (!(await fileExists(gitignorePath))) {
    await fs.writeFile(gitignorePath, DEFAULT_GITIGNORE);
  }

  // Use a repository-local identity fallback so the auto-commit never blocks
  // on a missing git user.name / user.email (repo-local only, never global).
  if (!(await readGitConfig(execFileAsync, directory, 'user.name'))) {
    await execFileAsync('git', ['config', 'user.name', 'esl upload'], { cwd: directory });
  }
  if (!(await readGitConfig(execFileAsync, directory, 'user.email'))) {
    await execFileAsync('git', ['config', 'user.email', 'esl@local'], { cwd: directory });
  }

  // Commit uncommitted changes so HEAD matches the source being uploaded.
  const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: directory });
  if (status.stdout.trim()) {
    await execFileAsync('git', ['add', '-A'], { cwd: directory });
    await execFileAsync('git', ['commit', '-m', 'chore: commit skill source for esl upload'], { cwd: directory });
  }
}

async function readGitConfig(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  key: string
): Promise<string> {
  try {
    const res = await execFileAsync('git', ['config', key], { cwd: directory });
    return res.stdout.trim();
  } catch {
    return '';
  }
}

async function uploadSource(
  options: UploadOptions,
  directory: string,
  skillName: string,
  description: string
): Promise<UploadedSkill> {
  const authToken = await requireFreshToken(options);
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/skills/upload'), {
    method: 'POST',
    headers: {
      Authorization: `token ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: skillName, description })
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
  try {
    await execFileAsync('git', ['-c', authHeader, 'push', 'esl', 'HEAD:main'], { cwd: directory });
  } catch (error) {
    // The source is already registered on the server; the push is the only
    // remaining step, so tell the user exactly how to finish it.
    throw new Error(
      `Failed to push the skill source to the server; re-run "esl upload" or run "git push esl HEAD:main" to finish: ${(error as Error).message}`
    );
  }
  return uploaded;
}

async function ensureEslRemote(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  cloneUrl: string
): Promise<void> {
  try {
    await execFileAsync('git', ['remote', 'add', 'esl', cloneUrl], { cwd: directory });
    return;
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (!message.includes('remote esl already exists') && !message.includes('remote `esl` already exists')) {
      throw error;
    }
  }
  // An interrupted Source Upload may be resumed when the existing Source Remote
  // already points at the same server source; a different URL must be resolved first.
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'esl'], { cwd: directory });
  const currentUrl = stdout.trim();
  if (currentUrl !== cloneUrl) {
    throw new Error(
      `Skill source already has an esl remote pointing at ${currentUrl}; remove it with "git remote remove esl" or point it at ${cloneUrl}`
    );
  }
}