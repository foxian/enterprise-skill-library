import { parseSkillName, isBuiltinIdentity } from '@esl/core';
import { apiUrl, fetchWithTimeout, requireFreshToken, resolveNetworkConfig, type NetworkCommandOptions } from './network-options.js';

export interface NotesOptions extends NetworkCommandOptions {
  message: string;
}

export interface UpdatedNotes {
  skillName: string;
  version: string;
  notes?: string;
}

export async function executeNotes(identity: string, version: string, options: NotesOptions): Promise<UpdatedNotes> {
  if (isBuiltinIdentity(identity)) {
    throw new Error(`Unknown built-in skill: ${identity}; built-in skills have no releases`);
  }
  const token = await requireFreshToken(options);
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const { scope, skillName } = parseSkillName(identity);
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    apiUrl(
      server,
      `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(skillName)}/releases/${encodeURIComponent(version)}/notes`
    ),
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: options.message })
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to update release notes: ${await response.text()}`);
  }
  return response.json() as Promise<UpdatedNotes>;
}
