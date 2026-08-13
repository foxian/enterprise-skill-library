import { apiUrl, fetchWithTimeout, type NetworkCommandOptions, resolveNetworkConfig } from './network-options.js';

export interface SkillInfo {
  name: string;
  description?: string;
  createdBy?: string;
  owner?: string;
  maintainers?: string[];
  versions?: string[];
  gitRepoPath?: string;
}

export async function executeInfo(name: string, options: NetworkCommandOptions = {}): Promise<SkillInfo> {
  const fetchImpl = options.customFetch ?? fetch;
  const registry = options.registry ?? (await resolveNetworkConfig(options)).registry;
  const res = await fetchWithTimeout(fetchImpl, apiUrl(registry, `/api/skills/${encodeURIComponent(name)}`));

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch skill info: ${err}`);
  }

  return (await res.json()) as SkillInfo;
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
