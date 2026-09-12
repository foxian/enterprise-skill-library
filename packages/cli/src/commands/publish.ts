import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import semver from 'semver';
import {
  fileExists,
  highestStableVersion,
  isBuiltinIdentity,
  validateSkillSourceDirectory
} from '@esl/core';
import { confirm, isInteractive, readText } from '../prompt.js';
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

export interface PublishOptions extends NetworkCommandOptions {
  directory?: string;
  /** @deprecated Version is now read from release.json; pass --version to point users at `esl version` */
  version?: string;
  visibility?: string;
  force?: boolean;
  noInput?: boolean;
  license?: string;
  message?: string;
  confirmInput?: () => Promise<boolean>;
  noteInput?: (collected: string) => Promise<string>;
  execFileAsync?: typeof defaultExecFileAsync;
  dryRun?: boolean;
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
      'Created release.json in the source directory; commit it, then run `esl version <SemVer>` to set the version before publishing.'
    );
  }
  if (options.version !== undefined) {
    throw new Error(
      '`esl publish` no longer takes a version argument. The version is read from release.json. Use `esl version` (major | minor | patch | <SemVer>) to set the version first.'
    );
  }
  return executeSourceRelease(options, directory);
}

async function executeSourceRelease(options: PublishOptions, directory: string): Promise<unknown> {
  const validation = await validateSkillSourceDirectory(directory);
  if (!validation.success) {
    throw new Error(`Invalid skill source: ${validation.errors.join(', ')}`);
  }
  const version = validation.data.releaseManifest.version;

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
  // A dry run stays entirely local: it validates the source and previews what
  // would be released, without syncing the source or creating a Skill Release.
  const head = options.dryRun
    ? (await git(options, directory, ['rev-parse', 'HEAD'])).trim()
    : await syncSource(options, directory, await requireFreshToken(options));
  await verifyReleaseTag(options, directory, version, head);
  const notes = await resolveReleaseNotes(options, directory);
  if (options.dryRun) {
    return {
      dryRun: true,
      name: identity,
      version,
      sourceCommit: head,
      files: Object.keys(await collectSourceFiles(directory)).sort(),
      notes
    };
  }
  await assertNotOlderThanPublished(options, identity, version);
  await confirmPublish(options, identity, version);
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
      files: await collectSourceFiles(directory),
      notes
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

async function resolveReleaseNotes(options: PublishOptions, directory: string): Promise<string> {
  if (options.message) {
    return options.message;
  }
  const collected = await collectChangesSinceLastTag(options, directory);
  if (options.noInput || options.noteInput) {
    if (options.noteInput) {
      return (await options.noteInput(collected)).trim() || collected;
    }
    return collected;
  }
  if (!isInteractive()) {
    return collected;
  }
  if (collected) {
    console.log(`\nChanges since the last release:\n${collected}\n`);
  }
  const answer = (await readText(collected ? 'Release note (Enter to use the above): ' : 'Release note (optional): ')).trim();
  return answer || collected;
}

async function collectChangesSinceLastTag(options: PublishOptions, directory: string): Promise<string> {
  let lastTag = '';
  try {
    lastTag = (await git(options, directory, ['describe', '--tags', '--abbrev=0'])).trim();
  } catch {
    lastTag = '';
  }
  try {
    const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
    const subjects = (await git(options, directory, ['log', range, '--format=%s'])).trim();
    if (!subjects) {
      return '';
    }
    return subjects.split('\n').map((subject) => `- ${subject.trim()}`).join('\n');
  } catch {
    return '';
  }
}

/**
 * Guard against publishing a version older than what is already released, which
 * would silently burn a version number on an immutable release. Releasing an
 * older line on purpose (a backport) stays possible through --force, which skips
 * this check along with the confirmation prompt.
 */
async function assertNotOlderThanPublished(
  options: PublishOptions,
  identity: string,
  version: string
): Promise<void> {
  if (options.force) {
    return;
  }
  const fetchImpl = options.customFetch ?? fetch;
  const { server } = await resolveNetworkConfig(options);
  const authToken = await requireFreshToken(options);

  let published: string[] = [];
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      apiUrl(server, `/api/skills/${encodeURIComponent(identity)}`),
      { headers: { Authorization: `token ${authToken}` } }
    );
    if (!response.ok) {
      return; // best effort: an unreachable listing must not block a release
    }
    const info = (await response.json()) as { versions?: string[] };
    published = info.versions ?? [];
  } catch {
    return;
  }

  const highest = highestStableVersion(published);
  if (highest && semver.lt(version, highest)) {
    throw new Error(
      `Cannot publish ${version}: ${highest} is already published and versions must move forward. Bump with \`esl version\` instead, or pass --force to release the older version on purpose.`
    );
  }
}

/**
 * Bring the server source up to date with the local branch before releasing, and
 * return the commit that will be released. An already-synced source is left
 * untouched (no push); a source that is behind is rebased and then pushed.
 */
async function syncSource(
  options: PublishOptions,
  directory: string,
  authToken: string
): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authHeader = gitAuthHeaderConfig(authToken);

  try {
    await execFileAsync('git', ['-c', authHeader, 'fetch', 'esl'], { cwd: directory });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot publish: failed to read the server source. Check that you are logged in and have access to this skill. (${detail})`
    );
  }

  let remoteHead = '';
  try {
    remoteHead = (await git(options, directory, ['rev-parse', 'esl/main'])).trim();
  } catch {
    remoteHead = ''; // the server source has no commits yet
  }

  if ((await git(options, directory, ['rev-parse', 'HEAD'])).trim() === remoteHead) {
    return remoteHead;
  }

  const behind = parseInt(
    (await git(options, directory, ['rev-list', '--count', 'HEAD..esl/main'])).trim() || '0',
    10
  );
  if (behind > 0) {
    try {
      await execFileAsync('git', ['rebase', 'esl/main'], { cwd: directory });
    } catch {
      throw new Error(
        'Cannot publish: the server source has newer commits and rebasing onto them hit a conflict. Resolve the conflicted files, finish the rebase, then run esl publish again.'
      );
    }
  }

  try {
    await execFileAsync('git', ['-c', authHeader, 'push', 'esl', 'HEAD:main'], { cwd: directory });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot publish: failed to push the source to the server. (${detail})`);
  }

  return (await git(options, directory, ['rev-parse', 'HEAD'])).trim();
}

async function verifyReleaseTag(
  options: PublishOptions,
  directory: string,
  version: string,
  head: string
): Promise<void> {
  const tag = `v${version}`;
  try {
    const tagCommit = (await git(options, directory, ['rev-list', '-n', '1', tag])).trim();
    if (tagCommit !== head) {
      throw new Error(
        `Tag ${tag} points to a different commit than HEAD. Run \`esl version\` on the commit you want to release.`
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('unknown revision') || msg.includes('bad revision') || msg.includes('fatal')) {
      throw new Error(
        `No release tag ${tag} found on HEAD. Run \`esl version <release>\` to bump the version and create the tag before publishing.`
      );
    }
    throw error;
  }
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