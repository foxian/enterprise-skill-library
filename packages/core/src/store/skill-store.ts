import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName } from '../schema/skill-json.js';

export interface InstallManifestSkill {
  identity: string;
  version: string;
  source: 'registry' | 'local' | 'builtin';
  specifier: string;
  resolved?: string;
  integrity?: string;
  skillId?: string;
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

export function skillSourceRelativeDir(identity: string): string {
  return path.join('skills', skillDirectoryName(identity));
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
