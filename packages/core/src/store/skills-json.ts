import fs from 'node:fs/promises';
import path from 'node:path';

import { BUILTIN_SPECIFIER_PREFIX } from '../skill/builtin-package.js';
import {
  loadInstallManifest,
  saveInstallManifest,
  skillDirectoryName,
  skillSourceRelativeDir,
  type InstallManifestSkill
} from './skill-store.js';
import { listToolLinks, type ToolLinkStatus, type ToolLevel, type ToolName } from '../link/tool-links.js';

export interface SkillsJson {
  skills: Record<string, string>;
}

export interface SkillsLockEntry {
  skillId?: string;
  identity?: string;
  version: string;
  resolved: string;
  integrity: string;
  source?: 'registry' | 'local' | 'builtin' | 'link';
}

export interface SkillsLockJson {
  lockfileVersion: number;
  skills: Record<string, SkillsLockEntry>;
}

const SKILLS_JSON_FILE = '.skills.json';
const SKILLS_LOCK_FILE = '.skills-lock.json';

function defaultSkillsJson(): SkillsJson {
  return { skills: {} };
}

function defaultSkillsLock(): SkillsLockJson {
  return { lockfileVersion: 1, skills: {} };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sourceFromSpecifier(specifier: string): InstallManifestSkill['source'] {
  if (specifier.startsWith('file:')) {
    return 'local';
  }
  if (specifier.startsWith('link:')) {
    return 'link';
  }
  if (specifier.startsWith(BUILTIN_SPECIFIER_PREFIX)) {
    return 'builtin';
  }
  return 'registry';
}

function manifestEntryFromLock(
  identity: string,
  entry: SkillsLockEntry,
  specifier: string,
  current?: InstallManifestSkill
): InstallManifestSkill {
  return {
    identity: entry.identity ?? identity,
    version: entry.version,
    source: entry.source ?? current?.source ?? sourceFromSpecifier(specifier),
    specifier: current?.specifier ?? specifier,
    resolved: entry.resolved,
    integrity: entry.integrity,
    skillId: entry.skillId,
    sourceDir: current?.sourceDir ?? skillSourceRelativeDir(identity),
    installedAt: current?.installedAt ?? new Date().toISOString()
  };
}

export async function loadSkillsJson(root: string): Promise<SkillsJson> {
  return readJsonFile(path.join(root, SKILLS_JSON_FILE), defaultSkillsJson());
}

// 项目依赖只声明技能，不再声明 AI 工具（ADR-0054）；遗留 tools 字段随正常写入消失。
export async function saveSkillsJson(root: string, data: SkillsJson): Promise<void> {
  await writeJsonFile(path.join(root, SKILLS_JSON_FILE), {
    skills: { ...data.skills }
  });
}

export async function loadSkillsLock(root: string): Promise<SkillsLockJson> {
  return readJsonFile(path.join(root, SKILLS_LOCK_FILE), defaultSkillsLock());
}

export async function saveSkillsLock(root: string, data: SkillsLockJson): Promise<void> {
  await writeJsonFile(path.join(root, SKILLS_LOCK_FILE), {
    lockfileVersion: data.lockfileVersion ?? 1,
    skills: { ...data.skills }
  });
}

export async function addSkillDependency(
  root: string,
  name: string,
  specifier: string
): Promise<void> {
  const current = await loadSkillsJson(root);
  await saveSkillsJson(root, {
    ...current,
    skills: { ...current.skills, [name]: specifier }
  });
}

export async function removeSkillDependency(root: string, name: string): Promise<void> {
  const skillsJson = await loadSkillsJson(root);
  delete skillsJson.skills[name];
  await saveSkillsJson(root, skillsJson);
}

export async function addLockEntry(
  root: string,
  name: string,
  entry: SkillsLockEntry
): Promise<void> {
  const lockJson = await loadSkillsLock(root);
  lockJson.skills[name] = {
    ...entry,
    identity: entry.identity ?? name,
    source: entry.source ?? sourceFromSpecifier(entry.resolved)
  };
  await saveSkillsLock(root, lockJson);
}

export async function removeLockEntry(root: string, name: string): Promise<void> {
  const lockJson = await loadSkillsLock(root);
  delete lockJson.skills[name];
  await saveSkillsLock(root, lockJson);
}

export async function recordInstalledSkill(
  storeRoot: string,
  name: string,
  entry: SkillsLockEntry,
  specifier?: string
): Promise<void> {
  const installManifest = await loadInstallManifest(storeRoot);
  installManifest.skills[name] = manifestEntryFromLock(
    name,
    entry,
    specifier ?? installManifest.skills[name]?.specifier ?? entry.resolved,
    installManifest.skills[name]
  );
  await saveInstallManifest(storeRoot, installManifest);
}

export async function removeInstalledSkill(storeRoot: string, name: string): Promise<void> {
  const installManifest = await loadInstallManifest(storeRoot);
  delete installManifest.skills[name];
  await saveInstallManifest(storeRoot, installManifest);
}

export async function renameSkillState(
  dependencyRoot: string,
  storeRoot: string,
  oldName: string,
  newName: string
): Promise<void> {
  const [skillsJson, lockJson, installManifest] = await Promise.all([
    loadSkillsJson(dependencyRoot),
    loadSkillsLock(dependencyRoot),
    loadInstallManifest(storeRoot)
  ]);
  const dependency = skillsJson.skills[oldName];
  const lockEntry = lockJson.skills[oldName];
  const installed = installManifest.skills[oldName];

  if (dependency !== undefined) {
    delete skillsJson.skills[oldName];
    skillsJson.skills[newName] = dependency;
  }
  if (lockEntry !== undefined) {
    delete lockJson.skills[oldName];
    lockJson.skills[newName] = { ...lockEntry, identity: newName };
  }
  if (installed !== undefined) {
    delete installManifest.skills[oldName];
    installManifest.skills[newName] = {
      ...installed,
      identity: newName,
      sourceDir: skillSourceRelativeDir(newName)
    };
  }

  await Promise.all([
    saveSkillsJson(dependencyRoot, skillsJson),
    saveSkillsLock(dependencyRoot, lockJson),
    saveInstallManifest(storeRoot, installManifest)
  ]);
}

export interface SkillToolSummary {
  tool: ToolName;
  status: ToolLinkStatus;
  managed: boolean;
}

export interface SkillListEntry {
  name: string;
  version: string;
  source: 'registry' | 'local' | 'builtin' | 'link';
  displayName?: string;
  tools?: SkillToolSummary[];
  linkSourcePath?: string;
}

export interface ListSkillsOptions {
  /** 传入时按该作用域汇总每个技能的 Tool Link（本机查询，不访问网络）。 */
  level?: ToolLevel;
  projectRoot?: string;
  homeDir?: string;
}

// 显示名只从本机已装内容尽力解析（Store 副本里的 release.json）；缺失或损坏时
// 由展示层回退到短名/Identity，不调用远程 info（ADR-0058）。
async function readLocalDisplayName(storeRoot: string, entry: InstallManifestSkill): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(storeRoot, entry.sourceDir, 'release.json'), 'utf8')
    ) as { displayName?: unknown };
    if (typeof parsed.displayName === 'string' && parsed.displayName.trim().length > 0) {
      return parsed.displayName.trim();
    }
  } catch {
    // 本机读取失败不阻断 list；显示名是可选字段。
  }
  return undefined;
}

export async function listSkills(
  root: string,
  options: ListSkillsOptions = {}
): Promise<SkillListEntry[]> {
  const manifest = await loadInstallManifest(root);
  const toolEntries = options.level
    ? await listToolLinks({
        storeRoot: root,
        level: options.level,
        projectRoot: options.projectRoot,
        homeDir: options.homeDir
      })
    : [];

  return Promise.all(
    Object.entries(manifest.skills).map(async ([name, entry]) => {
      const listEntry: SkillListEntry = { name, version: entry.version, source: entry.source };
      const displayName = await readLocalDisplayName(root, entry);
      if (displayName) {
        listEntry.displayName = displayName;
      }
      if (options.level) {
        // managed 记录的 identity 就是 Skill Identity；unmanaged 条目的 identity
        // 是工具目录里的目录名，按 ESL 的目录命名规则归属回技能（ADR-0058：
        // 详情/列表要能看到挂在该技能名下但不受 ESL 管理的内容）。
        listEntry.tools = toolEntries
          .filter(
            (link): link is typeof link & { tool: ToolName } =>
              (link.identity === name || link.identity === skillDirectoryName(name)) &&
              link.tool !== 'source'
          )
          .map((link) => ({ tool: link.tool, status: link.status, managed: link.managed }));
      }
      if (entry.source === 'link' && typeof entry.resolved === 'string' && entry.resolved.length > 0) {
        listEntry.linkSourcePath = entry.resolved;
      }
      return listEntry;
    })
  );
}

export { defaultInstallManifest, loadInstallManifest, saveInstallManifest } from './skill-store.js';
