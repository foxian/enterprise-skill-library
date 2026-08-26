import fs from 'node:fs/promises';
import path from 'node:path';
import { apiUrl, fetchWithTimeout, type NetworkCommandOptions, resolveNetworkConfig } from './network-options.js';
import { isBuiltinIdentity, loadBuiltinPackageOrThrow } from '@esl/core';
import { resolveBuiltinDir } from '../builtin-dir.js';

export interface SkillInfo {
  name: string;
  description?: string;
  createdBy?: string;
  owner?: string;
  maintainers?: string[];
  versions?: string[];
  gitRepoPath?: string;
  cloneUrl?: string;
  publishedPackage?: boolean;
  skillId?: string;
  status?: string;
  packageUrl?: string;
  releases?: Array<{ version: string; checksum: string; packageUrl?: string }>;
  currentName?: string;
  oldName?: string;
}

export async function executeInfo(name: string, options: NetworkCommandOptions = {}): Promise<SkillInfo> {
  if (isBuiltinIdentity(name)) {
    return infoFromBuiltin(name, options);
  }
  const fetchImpl = options.customFetch ?? fetch;
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, `/api/skills/${encodeURIComponent(name)}`));

  if (!res.ok && res.status !== 301) {
    const err = await res.text();
    throw new Error(`Failed to fetch skill info: ${err}`);
  }

  const info = (await res.json()) as SkillInfo;
  if (res.status !== 301 || !info.currentName) {
    return info;
  }

  const current = await executeInfo(info.currentName, options);
  return {
    ...current,
    oldName: name,
    currentName: info.currentName
  };
}

async function infoFromBuiltin(name: string, options: NetworkCommandOptions): Promise<SkillInfo> {
  const builtinDir = options.builtinDir ?? resolveBuiltinDir();
  const builtin = await loadBuiltinPackageOrThrow(builtinDir, name);
  const skillJson = JSON.parse(await fs.readFile(path.join(builtin.directory, 'skill.json'), 'utf8')) as {
    description?: string;
  };
  return {
    name,
    description: skillJson.description,
    versions: [builtin.version]
  };
}

export function formatSkillInfo(info: SkillInfo): string {
  const lines: string[] = [`Name: ${info.name}`];
  if (info.description) {
    lines.push(`Description: ${info.description}`);
  }
  if (info.versions && info.versions.length > 0) {
    lines.push(`Versions: ${info.versions.join(', ')}`);
  }
  if (info.gitRepoPath) {
    lines.push(`Repository: ${info.gitRepoPath}`);
  }
  return lines.join('\n');
}
