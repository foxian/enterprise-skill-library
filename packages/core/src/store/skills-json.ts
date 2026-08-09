import fs from 'node:fs/promises';
import path from 'node:path';

export interface SkillsJson {
  skills: Record<string, string>;
  tools?: string[];
}

export interface SkillsLockEntry {
  version: string;
  resolved: string;
  integrity: string;
}

export interface SkillsLockJson {
  lockfileVersion: number;
  skills: Record<string, SkillsLockEntry>;
}

const SKILLS_JSON = '.skills.json';
const SKILLS_LOCK_JSON = '.skills-lock.json';

function defaultSkillsJson(): SkillsJson {
  return { skills: {} };
}

function defaultSkillsLock(): SkillsLockJson {
  return { lockfileVersion: 1, skills: {} };
}

async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function loadSkillsJson(projectRoot: string): Promise<SkillsJson> {
  return readJsonFile(path.join(projectRoot, SKILLS_JSON), defaultSkillsJson());
}

export async function saveSkillsJson(projectRoot: string, data: SkillsJson): Promise<void> {
  await writeJsonFile(path.join(projectRoot, SKILLS_JSON), data);
}

export async function loadSkillsLock(projectRoot: string): Promise<SkillsLockJson> {
  return readJsonFile(path.join(projectRoot, SKILLS_LOCK_JSON), defaultSkillsLock());
}

export async function saveSkillsLock(projectRoot: string, data: SkillsLockJson): Promise<void> {
  await writeJsonFile(path.join(projectRoot, SKILLS_LOCK_JSON), data);
}

export async function addSkillDependency(
  projectRoot: string,
  name: string,
  specifier: string
): Promise<void> {
  const data = await loadSkillsJson(projectRoot);
  data.skills[name] = specifier;
  await saveSkillsJson(projectRoot, data);
}

export async function removeSkillDependency(projectRoot: string, name: string): Promise<void> {
  const skillsData = await loadSkillsJson(projectRoot);
  delete skillsData.skills[name];
  await saveSkillsJson(projectRoot, skillsData);

  const lockData = await loadSkillsLock(projectRoot);
  delete lockData.skills[name];
  await saveSkillsLock(projectRoot, lockData);
}

export async function addLockEntry(
  projectRoot: string,
  name: string,
  entry: SkillsLockEntry
): Promise<void> {
  const data = await loadSkillsLock(projectRoot);
  data.skills[name] = entry;
  await saveSkillsLock(projectRoot, data);
}

export interface SkillListEntry {
  name: string;
  version: string;
  source: 'registry' | 'local';
}

export async function listSkills(projectRoot: string): Promise<SkillListEntry[]> {
  const lock = await loadSkillsLock(projectRoot);
  const entries = Object.entries(lock.skills);

  if (entries.length > 0) {
    return entries.map(([name, entry]) => ({
      name,
      version: entry.version,
      source: entry.resolved.startsWith('file:') ? 'local' as const : 'registry' as const
    }));
  }

  const skillsJson = await loadSkillsJson(projectRoot);
  return Object.entries(skillsJson.skills).map(([name, specifier]) => ({
    name,
    version: specifier,
    source: specifier.startsWith('file:') ? 'local' as const : 'registry' as const
  }));
}
