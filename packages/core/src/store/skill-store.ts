import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName } from '../schema/skill-json.js';

export interface InstallManifestSkill {
  identity: string;
  version: string;
  source: 'registry' | 'local' | 'builtin' | 'link';
  specifier: string;
  resolved?: string;
  integrity?: string;
  skillId?: string;
  /** Server-hosted 技能的来源实例（ADR-0071）；builtin/local/link 没有。 */
  instanceId?: string;
  /**
   * 用户明确保留的传递依赖（ADR-0072）：不再进入清理候选，也不会在后续
   * update/uninstall 中被静默回收。只作用于已装副本，不是直接依赖声明。
   */
  retained?: boolean;
  sourceDir: string;
  installedAt: string;
}

export interface InstallManifest {
  version: 1;
  tools?: string[];
  skills: Record<string, InstallManifestSkill>;
}

export const INSTALL_MANIFEST_FILE = '.esl-install-manifest.json';

export function skillDirectoryName(identity: string): string {
  const { scope, skillName } = parseSkillName(identity);
  return `${scope}_${skillName}`;
}

export function skillSourceDirectoryName(identity: string): string {
  const { scope, skillName } = parseSkillName(identity);
  return path.join(`@${scope}`, skillName);
}

/**
 * Store 内实例隔离层级（ADR-0071）：Server-hosted 技能放在完整 Instance ID
 * 目录下；builtin/local/link 继续沿用无实例的旧路径。
 */
export function skillSourceRelativeDir(identity: string, instanceId?: string | null): string {
  return instanceId
    ? path.join('skills', instanceId, skillSourceDirectoryName(identity))
    : path.join('skills', skillSourceDirectoryName(identity));
}

/** 安装清单键：不同实例的同名技能必须各自成条，不能互相覆盖。 */
export function installManifestKey(identity: string, instanceId?: string | null): string {
  return instanceId ? `${identity}#${instanceId}` : identity;
}

export function parseInstallManifestKey(key: string): { identity: string; instanceId?: string } {
  const separator = key.lastIndexOf('#');
  if (separator > 0) {
    const instanceId = key.slice(separator + 1);
    const identity = key.slice(0, separator);
    if (identity.startsWith('@') && identity.includes('/')) {
      return { identity, instanceId };
    }
  }
  return { identity: key };
}

/** 在安装清单中按 Identity + 可选实例查找条目。 */
export function findInstalledSkill(
  manifest: InstallManifest,
  identity: string,
  instanceId?: string | null
): { key: string; entry: InstallManifestSkill } | null {
  if (instanceId) {
    const key = installManifestKey(identity, instanceId);
    const entry = manifest.skills[key];
    if (entry) {
      return { key, entry };
    }
  }
  const legacy = manifest.skills[identity];
  if (legacy) {
    return { key: identity, entry: legacy };
  }
  for (const [key, entry] of Object.entries(manifest.skills)) {
    if (
      entry.identity === identity &&
      (!instanceId || entry.instanceId === undefined || entry.instanceId === instanceId)
    ) {
      return { key, entry };
    }
  }
  return null;
}

/**
 * 记录或取消「用户保留」意图（ADR-0072）。保留意图只影响清理候选，不改写
 * 作者依赖声明，也不会把传递依赖提升成直接依赖。
 */
export async function setInstalledSkillRetained(
  storeRoot: string,
  identity: string,
  instanceId: string | null | undefined,
  retained: boolean
): Promise<boolean> {
  const manifest = await loadInstallManifest(storeRoot);
  const found = findInstalledSkill(manifest, identity, instanceId);
  if (!found) {
    return false;
  }
  if (retained) {
    found.entry.retained = true;
  } else {
    delete found.entry.retained;
  }
  await saveInstallManifest(storeRoot, manifest);
  return true;
}

export function installManifestPath(storeRoot: string): string {
  return path.join(storeRoot, INSTALL_MANIFEST_FILE);
}

export function defaultInstallManifest(): InstallManifest {
  return { version: 1, skills: {} };
}

export async function loadInstallManifest(storeRoot: string): Promise<InstallManifest> {
  try {
    const raw = await fs.readFile(installManifestPath(storeRoot), 'utf8');
    const parsed = JSON.parse(raw) as InstallManifest;
    if (parsed.version !== 1 || typeof parsed.skills !== 'object' || parsed.skills === null) {
      throw new Error('Invalid ESL install manifest');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultInstallManifest();
    }
    throw error;
  }
}

/**
 * 已装副本声明的发布依赖（ADR-0072）。普通安装读生成的 `skill.json`；Skill
 * Source Link 的 Store 位置指向源码目录、通常没有 `skill.json`，回退读源码的
 * `release.json`。两者都缺失或不可读时视为空（无发布依赖）。
 */
export function readInstalledDependencies(
  storeRoot: string,
  identity: string,
  instanceId?: string
): Record<string, string> {
  const directory = path.join(storeRoot, skillSourceRelativeDir(identity, instanceId));
  for (const file of ['skill.json', 'release.json']) {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(path.join(directory, file), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      return parsed.dependencies ?? {};
    } catch {
      // 试下一个文件。
    }
  }
  return {};
}

/**
 * 已装技能的依赖缺失：声明的发布依赖在安装清单中找不到对应副本（同实例）。
 * 用于在已装技能查看入口呈现「安装存在 ≠ 依赖齐全」（ADR-0072）。
 */
export async function findMissingDependencies(
  storeRoot: string
): Promise<Map<string, string[]>> {
  const manifest = await loadInstallManifest(storeRoot);
  const missing = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(manifest.skills)) {
    const identity = entry.identity ?? parseInstallManifestKey(key).identity;
    const dependencies = readInstalledDependencies(storeRoot, identity, entry.instanceId);
    const absent = Object.keys(dependencies).filter(
      (dependency) => !findInstalledSkill(manifest, dependency, entry.instanceId)
    );
    if (absent.length > 0) {
      missing.set(installManifestKey(identity, entry.instanceId), absent);
    }
  }
  return missing;
}

export async function saveInstallManifest(storeRoot: string, manifest: InstallManifest): Promise<void> {
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.writeFile(
    installManifestPath(storeRoot),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}
