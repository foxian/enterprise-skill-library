import fs from 'node:fs/promises';
import path from 'node:path';
import type { SkillsLockEntry } from '../store/skills-json.js';
import { skillSourceDirectoryName, skillSourceRelativeDir, type InstallManifestSkill } from '../store/skill-store.js';

export interface LinkStagingMetadata {
  dependencySpecifier?: string;
  lockEntry?: SkillsLockEntry;
  manifestEntry?: InstallManifestSkill;
}

export interface LinkStagingRecord extends LinkStagingMetadata {
  identity: string;
  sourceDir: string;
  originalDir: string;
  stagedDir: string;
}

export interface LinkSkillOptions {
  identity: string;
  sourceDir: string;
  storeRoot: string;
  force?: boolean;
  previous?: LinkStagingMetadata;
}

export interface LinkSkillResult {
  identity: string;
  sourceDir: string;
  targetDir: string;
  status: 'linked' | 'relinked';
  staged: boolean;
}

export interface UnlinkSkillDirectoryResult {
  restored: boolean;
  record?: LinkStagingRecord;
}

const LINK_STAGING_RECORD_FILE = '.esl-link-staging.json';

type LinkStagingStore = Record<string, LinkStagingRecord>;

export function linkStagingRelativeDir(): string {
  return path.join('link-staging');
}

export function linkStagingRecordPath(storeRoot: string): string {
  return path.join(storeRoot, LINK_STAGING_RECORD_FILE);
}

function linkStagingDir(storeRoot: string, identity: string): string {
  return path.join(storeRoot, linkStagingRelativeDir(), skillSourceDirectoryName(identity));
}

async function loadLinkStagingStore(storeRoot: string): Promise<LinkStagingStore> {
  try {
    const raw = await fs.readFile(linkStagingRecordPath(storeRoot), 'utf8');
    const parsed = JSON.parse(raw) as LinkStagingStore;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid ESL link staging record');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function saveLinkStagingStore(storeRoot: string, records: LinkStagingStore): Promise<void> {
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.writeFile(
    linkStagingRecordPath(storeRoot),
    `${JSON.stringify(records, null, 2)}\n`,
    'utf8'
  );
}
async function isSymbolicLink(targetDir: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(targetDir);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function readLinkTarget(linkPath: string): Promise<string> {
  const target = await fs.readlink(linkPath);
  return path.resolve(path.dirname(linkPath), target);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function createSourceLink(sourceDir: string, targetDir: string): Promise<void> {
  if (process.platform === 'win32') {
    await fs.symlink(sourceDir, targetDir, 'junction');
  } else {
    await fs.symlink(sourceDir, targetDir, 'dir');
  }
}
async function assertStagingAvailable(
  storeRoot: string,
  identity: string,
  stagedDir: string
): Promise<void> {
  const records = await loadLinkStagingStore(storeRoot);
  if (records[identity]) {
    throw new Error(`Link staging already contains ${identity}`);
  }

  try {
    await fs.access(stagedDir);
    throw new Error(`Unexpected content exists at link staging path for ${identity}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function stageOriginalDirectory(options: {
  identity: string;
  sourceDir: string;
  storeRoot: string;
  targetDir: string;
  stagedDir: string;
  metadata?: LinkStagingMetadata;
}): Promise<void> {
  const { identity, sourceDir, storeRoot, targetDir, stagedDir, metadata } = options;
  const record: LinkStagingRecord = {
    identity,
    sourceDir,
    originalDir: targetDir,
    stagedDir,
    ...(metadata ?? {})
  };

  await fs.mkdir(path.dirname(stagedDir), { recursive: true });
  await fs.rename(targetDir, stagedDir);
  const records = await loadLinkStagingStore(storeRoot);
  records[identity] = record;

  try {
    await saveLinkStagingStore(storeRoot, records);
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await createSourceLink(sourceDir, targetDir);
  } catch (error) {
    const rollbackRecords = await loadLinkStagingStore(storeRoot);
    delete rollbackRecords[identity];
    try {
      await saveLinkStagingStore(storeRoot, rollbackRecords);
      await fs.rename(stagedDir, targetDir);
    } catch (rollbackError) {
      throw new Error(
        `Failed to create skill source link and roll back staging: ${(rollbackError as Error).message}`,
        { cause: error }
      );
    }
    throw error;
  }
}

export async function linkSkillDirectory(options: LinkSkillOptions): Promise<LinkSkillResult> {
  const { identity, storeRoot, force = false } = options;
  const sourceDir = path.resolve(options.sourceDir);
  const targetDir = path.resolve(storeRoot, skillSourceRelativeDir(identity));
  const stagedDir = linkStagingDir(storeRoot, identity);

  if (!(await directoryExists(sourceDir))) {
    throw new Error(`Skill source directory does not exist: ${sourceDir}`);
  }

  if (isInside(sourceDir, targetDir)) {
    throw new Error(`Skill source link target must not be inside the source directory: ${targetDir}`);
  }

  if (await isSymbolicLink(targetDir)) {
    const currentTarget = await readLinkTarget(targetDir);
    if (samePath(currentTarget, sourceDir)) {
      return { identity, sourceDir, targetDir, status: 'linked', staged: false };
    }
    if (!force) {
      throw new Error(`Skill ${identity} is already linked to ${currentTarget}; use --force to replace it`);
    }
    await fs.rm(targetDir, { force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await createSourceLink(sourceDir, targetDir);
    return { identity, sourceDir, targetDir, status: 'relinked', staged: false };
  }
  if (await directoryExists(targetDir)) {
    if (!force) {
      throw new Error(`Skill ${identity} is already installed at ${targetDir}; use --force to link it`);
    }
    await assertStagingAvailable(storeRoot, identity, stagedDir);
    await stageOriginalDirectory({
      identity,
      sourceDir,
      storeRoot,
      targetDir,
      stagedDir,
      metadata: options.previous
    });
    return { identity, sourceDir, targetDir, status: 'relinked', staged: true };
  }

  try {
    await fs.lstat(targetDir);
    throw new Error(`Skill target must not be a regular file: ${targetDir}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await createSourceLink(sourceDir, targetDir);
  return { identity, sourceDir, targetDir, status: 'linked', staged: false };
}

export async function hasLinkStagingRecord(identity: string, storeRoot: string): Promise<boolean> {
  const records = await loadLinkStagingStore(storeRoot);
  return Boolean(records[identity]);
}

export async function unlinkSkillDirectory(
  identity: string,
  storeRoot: string
): Promise<UnlinkSkillDirectoryResult> {
  const targetDir = path.resolve(storeRoot, skillSourceRelativeDir(identity));
  const records = await loadLinkStagingStore(storeRoot);
  const record = records[identity];

  if (!await isSymbolicLink(targetDir)) {
    try {
      await fs.lstat(targetDir);
      throw new Error(`Skill ${identity} target is not a skill source link: ${targetDir}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  if (!record) {
    await fs.rm(targetDir, { force: true });
    return { restored: false };
  }

  if (!(await directoryExists(record.stagedDir))) {
    throw new Error(`Link staging for ${identity} is missing its original copy; link state was kept`);
  }
  if (!samePath(record.originalDir, targetDir)) {
    throw new Error(`Link staging for ${identity} points to an unexpected original location`);
  }

  await fs.rm(targetDir, { force: true });
  try {
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.rename(record.stagedDir, targetDir);
  } catch (error) {
    await createSourceLink(record.sourceDir, targetDir);
    throw error;
  }

  delete records[identity];
  await saveLinkStagingStore(storeRoot, records);
  await fs.rmdir(path.dirname(record.stagedDir)).catch(() => {});
  await fs.rmdir(path.join(storeRoot, linkStagingRelativeDir())).catch(() => {});
  return { restored: true, record };
}
export async function removeLinkedSkillDirectory(identity: string, storeRoot: string): Promise<void> {
  const targetDir = path.resolve(storeRoot, skillSourceRelativeDir(identity));
  const records = await loadLinkStagingStore(storeRoot);
  const record = records[identity];

  if (!await isSymbolicLink(targetDir)) {
    try {
      await fs.lstat(targetDir);
      throw new Error(`Skill ${identity} target is not a skill source link: ${targetDir}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  await fs.rm(targetDir, { force: true });
  if (record) {
    if (!(await directoryExists(record.stagedDir))) {
      throw new Error(`Link staging for ${identity} is missing its original copy`);
    }
    await fs.rm(record.stagedDir, { recursive: true, force: true });
    delete records[identity];
    await saveLinkStagingStore(storeRoot, records);
  }
}

export async function isLinkedSkill(identity: string, storeRoot: string): Promise<boolean> {
  const targetDir = path.resolve(storeRoot, skillSourceRelativeDir(identity));
  return isSymbolicLink(targetDir);
}


