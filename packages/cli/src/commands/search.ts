import { apiUrl, type NetworkCommandOptions, resolveNetworkConfig } from './network-options.js';

export interface SkillSearchResult {
  name: string;
  description: string;
}

export async function executeSearch(
  query: string,
  options: NetworkCommandOptions = {}
): Promise<SkillSearchResult[]> {
  const fetchImpl = options.customFetch ?? fetch;
  const registry = options.registry ?? (await resolveNetworkConfig(options)).registry;
  const res = await fetchImpl(apiUrl(registry, `/api/skills/search?q=${encodeURIComponent(query)}`));

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to search skills: ${err}`);
  }

  return (await res.json()) as SkillSearchResult[];
}
