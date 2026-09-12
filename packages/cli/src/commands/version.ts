import { isBuiltinIdentity, validateReleaseManifest, type ReleaseManifest } from '@esl/core';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type BumpType = 'major' | 'minor' | 'patch';
type VersionInput = BumpType | string; // explicit SemVer

function isBump(input: string): input is BumpType {
  return input === 'major' || input === 'minor' || input === 'patch';
}

function nextVersion(current: string, bump: BumpType): string {
  const [major, minor, patch] = current.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function isInsideGitRepo(dir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

async function hasCleanWorkingTree(dir: string): Promise<boolean> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir });
  return stdout.trim().length === 0;
}

type RawManifestResult =
  | { valid: true; data: ReleaseManifest }
  | { valid: false; isPreVersion: boolean; errors: string[] }
  | null;

async function readManifest(dir: string): Promise<RawManifestResult> {
  const manifestPath = path.join(dir, 'release.json');
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = validateReleaseManifest(parsed);
  if (result.success) return { valid: true, data: result.data };
  const isPreVersion =
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { schemaVersion?: unknown }).schemaVersion === 1;
  return { valid: false, isPreVersion, errors: result.errors };
}

async function readSkillJsonName(dir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'skill.json'), 'utf8');
    const data = JSON.parse(raw) as { name?: string };
    return data.name ?? null;
  } catch {
    return null;
  }
}

async function writeVersion(dir: string, version: string): Promise<void> {
  const manifestPath = path.join(dir, 'release.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const data = JSON.parse(raw) as Record<string, unknown>;
  data.schemaVersion = 2;
  data.version = version;
  await fs.writeFile(manifestPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function commitAndTag(dir: string, version: string): Promise<void> {
  const tag = `v${version}`;
  await execFileAsync('git', ['add', 'release.json'], { cwd: dir });
  const staged = (await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: dir })).stdout.trim();
  // Tagging the version the source already carries (the first release, where
  // `init` seeded it) has nothing to commit — the tag is the whole point.
  if (staged) {
    await execFileAsync('git', ['commit', '-m', `chore: bump version to ${version}`], { cwd: dir });
  }
  await execFileAsync('git', ['tag', '-a', tag, '-m', `Release ${version}`], { cwd: dir });
}

export async function executeVersion(
  input: VersionInput,
  options: { cwd?: string; execFile?: typeof execFileAsync } = {}
): Promise<string> {
  const directory = options.cwd ?? process.cwd();

  // Built-in identity check first — highest-priority rejection, regardless of directory shape
  const skillName = await readSkillJsonName(directory);
  if (skillName && isBuiltinIdentity(skillName)) {
    throw new Error(
      'Built-in skills cannot be versioned; their version is pinned to the ESL CLI version.'
    );
  }

  // Check git — without a repo, we can't commit/tag
  if (!(await isInsideGitRepo(directory))) {
    throw new Error(
      'This directory is not a git repository. Run `git init` and commit the skill source before using `esl version`.'
    );
  }

  const manifestResult = await readManifest(directory);

  // No release.json at all — this is not a source-form skill
  if (manifestResult === null) {
    throw new Error(
      'No release.json found. `esl version` operates on a source-form skill directory (SKILL.md + release.json).'
    );
  }

  // Pre-version (schemaVersion 1) manifest — explicit version migrates, bump rejects
  if (!manifestResult.valid && manifestResult.isPreVersion) {
    if (isBump(input)) {
      throw new Error(
        'This release manifest is from before version tracking (schemaVersion 1). Run `esl version <SemVer>` with an explicit version number to initialize versioning and upgrade the manifest to schemaVersion 2.'
      );
    }
    // explicit version → upgrade to v2 and set value (falls through)
  } else if (!manifestResult.valid) {
    throw new Error(`Invalid release.json: ${manifestResult.errors.join(', ')}`);
  }

  let newVersion: string;
  const currentVersion =
    manifestResult.valid ? manifestResult.data.version : null;

  if (isBump(input)) {
    if (!currentVersion) {
      // unreachable: bump is rejected above for pre-version; other invalid forms error above
      throw new Error('Cannot bump: no current version found in release.json.');
    }
    newVersion = nextVersion(currentVersion, input);
  } else {
    // explicit SemVer — validate syntax
    const semverRegex = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
    if (!semverRegex.test(input)) {
      throw new Error(`Invalid version: ${input}. Version must be valid SemVer (e.g. 1.2.3).`);
    }
    newVersion = input;
  }

  if (!(await hasCleanWorkingTree(directory))) {
    throw new Error(
      'Working tree is not clean. Commit or stash your changes before bumping the version so the version commit contains only the manifest change.'
    );
  }

  await writeVersion(directory, newVersion);
  await commitAndTag(directory, newVersion);

  return newVersion;
}
