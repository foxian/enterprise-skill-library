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
import { confirm, isInteractive, readText } from '../prompt.js';

const defaultExecFileAsync = promisify(execFile);

const DEFAULT_COMMIT_MESSAGE = 'chore: commit skill source for esl upload';

export interface UploadOptions extends NetworkCommandOptions {
  directory?: string;
  license?: string;
  message?: string;
  noInput?: boolean;
  confirmInput?: () => Promise<boolean>;
  execFileAsync?: typeof defaultExecFileAsync;
}

export interface UploadedSkill {
  name: string;
  skillId: string;
  cloneUrl: string;
  status?: string;
  alreadyUpToDate?: boolean;
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
  const message = await resolveUploadMessage(options);
  await prepareSourceGit(execFileAsync, directory, message);
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

async function resolveUploadMessage(options: UploadOptions): Promise<string> {
  if (options.message) {
    return options.message;
  }
  if (options.noInput || !isInteractive()) {
    return '';
  }
  return (await readText('Describe this upload (optional, press Enter to skip): ')).trim();
}

async function prepareSourceGit(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  message: string
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

  // If a previous upload hit a merge conflict and left a rebase in progress,
  // the user has resolved the marked files: continue that rebase instead of
  // creating a new commit on top of the conflicted state.
  if (await isRebaseInProgress(directory)) {
    await execFileAsync('git', ['add', '-A'], { cwd: directory });
    try {
      await execFileAsync('git', ['rebase', '--continue'], { cwd: directory });
    } catch (error) {
      throw new Error(
        `Still have unresolved source conflicts; resolve the marked files then re-run "esl upload": ${(error as Error).message}`
      );
    }
  } else {
    // Commit uncommitted changes so HEAD matches the source being uploaded,
    // using the user-provided upload message as the commit message when given.
    const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: directory });
    if (status.stdout.trim()) {
      await execFileAsync('git', ['add', '-A'], { cwd: directory });
      await execFileAsync('git', ['commit', '-m', message || DEFAULT_COMMIT_MESSAGE], { cwd: directory });
    }
  }
}

async function isRebaseInProgress(directory: string): Promise<boolean> {
  return (
    (await fileExists(path.join(directory, '.git', 'rebase-merge'))) ||
    (await fileExists(path.join(directory, '.git', 'rebase-apply')))
  );
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
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authHeader = gitAuthHeaderConfig(authToken);

  let uploaded: UploadedSkill;
  if (await hasEslRemote(execFileAsync, directory)) {
    // Already server-hosted: skip the registration call and sync straight
    // against the existing source.
    const remoteUrl = (await execFileAsync('git', ['remote', 'get-url', 'esl'], { cwd: directory })).stdout.trim();
    const remoteShortName = remoteUrl.match(/[^/]+(?=\.git)/)?.[0] ?? '';
    if (remoteShortName && remoteShortName !== skillName) {
      throw new Error(
        `Local skill name "${skillName}" does not match the source repository "${remoteShortName}"; ` +
          'renames must go through "esl rename", not by editing SKILL.md'
      );
    }
    uploaded = { name: skillNameFromRemote(remoteUrl), skillId: '', cloneUrl: remoteUrl };
  } else {
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
    uploaded = (await response.json()) as UploadedSkill;
    if (!uploaded.cloneUrl || !uploaded.skillId || !uploaded.name) {
      throw new Error('Failed to upload skill source: API response is incomplete');
    }
    await ensureEslRemote(execFileAsync, directory, uploaded.cloneUrl);
  }

  try {
    if ((await syncSource(execFileAsync, directory, authHeader)) === 'up-to-date') {
      return { ...uploaded, alreadyUpToDate: true };
    }
  } catch (error) {
    if (isSourceGone(error)) {
      return handleOrphanedSource(execFileAsync, directory, options, (error as Error).message, skillName, description);
    }
    throw error;
  }
  try {
    await execFileAsync('git', ['-c', authHeader, 'push', 'esl', 'HEAD:main'], { cwd: directory });
  } catch (error) {
    if (isSourceGone(error)) {
      return handleOrphanedSource(execFileAsync, directory, options, (error as Error).message, skillName, description);
    }
    // The source is already registered on the server; the push is the only
    // remaining step, so tell the user exactly how to finish it.
    throw new Error(
      `Failed to push the skill source to the server; re-run "esl upload" or run "git push esl HEAD:main" to finish: ${(error as Error).message}`
    );
  }
  return uploaded;
}

async function handleOrphanedSource(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  options: UploadOptions,
  detail: string,
  skillName: string,
  description: string
): Promise<UploadedSkill> {
  if (options.noInput) {
    throw new Error(orphanedSourceGuidance(detail));
  }
  let reset: boolean;
  if (options.confirmInput) {
    reset = await options.confirmInput();
  } else if (isInteractive()) {
    reset = await confirm(
      'The server source was deleted; the local esl remote points at a removed repository (orphan). ' +
        'Remove the esl remote and re-register this source? [y/N] '
    );
  } else {
    throw new Error(orphanedSourceGuidance(detail));
  }
  if (!reset) {
    throw new Error(orphanedSourceGuidance(detail));
  }
  await execFileAsync('git', ['remote', 'remove', 'esl'], { cwd: directory });
  return uploadSource(options, directory, skillName, description);
}

function orphanedSourceGuidance(detail: string): string {
  return (
    `The server source no longer exists; the local esl remote points at a deleted repository. ` +
    `Run "git remote remove esl" then "esl upload --directory ." to register a fresh source. ` +
    `(${detail})`
  );
}

function isSourceGone(error: unknown): boolean {
  const message = (error as Error).message ?? '';
  return /not found|404|does not exist/i.test(message);
}

function skillNameFromRemote(remoteUrl: string): string {
  const match = remoteUrl.match(/\/git\/(.+?)(?:\.git)?\/?$/);
  return match ? `@${match[1]}` : 'source';
}

async function hasEslRemote(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string
): Promise<boolean> {
  try {
    const res = await execFileAsync('git', ['remote', 'get-url', 'esl'], { cwd: directory });
    return res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function syncSource(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  authHeader: string
): Promise<'up-to-date' | 'needs-push'> {
  // Refresh the server-side ref so we can compare and rebase onto it.
  try {
    await execFileAsync('git', ['-c', authHeader, 'fetch', 'esl'], { cwd: directory });
  } catch (error) {
    if (isSourceGone(error)) {
      throw error; // orphaned source: let the caller prompt or guide
    }
    return 'needs-push'; // remote unreachable or empty; let the push surface the real error
  }
  let remoteHead: string;
  try {
    remoteHead = (await execFileAsync('git', ['rev-parse', '--verify', 'esl/main'], { cwd: directory })).stdout.trim();
  } catch {
    return 'needs-push'; // the server source has no commits yet (first push)
  }
  const localHead = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  if (localHead === remoteHead) {
    return 'up-to-date';
  }
  const behind = parseInt(
    (await execFileAsync('git', ['rev-list', '--count', 'HEAD..esl/main'], { cwd: directory })).stdout.trim() || '0',
    10
  );
  if (behind > 0) {
    // Rebase local commits onto the server source. On a content conflict the
    // rebase is left in progress so the user can resolve the marked files and
    // re-run upload to finish the merge and push.
    try {
      await execFileAsync('git', ['rebase', 'esl/main'], { cwd: directory });
    } catch {
      throw new Error(
        `Source update conflict: the server source advanced by ${behind} commit(s) and your local edits overlap. ` +
          'Conflicted files are marked in your editor; resolve them, then re-run "esl upload" to finish the merge and push.'
      );
    }
  }
  return 'needs-push';
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