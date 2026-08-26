import { apiUrl, fetchWithTimeout, type NetworkCommandOptions, resolveNetworkConfig } from './network-options.js';
import { isBuiltinIdentity } from '@esl/core';

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

  const results = (await res.json()) as SkillSearchResult[];
  return results.filter((result) => !isBuiltinIdentity(result.name));
}
