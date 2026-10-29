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

export async function saveInstallManifest(storeRoot: string, manifest: InstallManifest): Promise<void> {
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.writeFile(
    installManifestPath(storeRoot),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}
