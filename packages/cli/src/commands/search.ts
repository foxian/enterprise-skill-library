import { apiUrl, fetchWithTimeout, type NetworkCommandOptions, resolveNetworkConfig } from './network-options.js';

export interface SkillSearchResult {
  name: string;
  description: string;
}

export async function executeSearch(
  query: string,
  options: NetworkCommandOptions = {}
): Promise<SkillSearchResult[]> {
  const fetchImpl = options.customFetch ?? fetch;
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, `/api/skills/search?q=${encodeURIComponent(query)}`));

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to search skills: ${err}`);
  }

  return (await res.json()) as SkillSearchResult[];
}
