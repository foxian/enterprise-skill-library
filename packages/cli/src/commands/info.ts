import { apiUrl, type NetworkCommandOptions, resolveNetworkConfig } from './network-options.js';

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
  const res = await fetchImpl(apiUrl(registry, `/api/skills/${encodeURIComponent(name)}`));

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch skill info: ${err}`);
  }

  return (await res.json()) as SkillInfo;
}
