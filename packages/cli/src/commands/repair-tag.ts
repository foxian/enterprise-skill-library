import { apiUrl, fetchWithTimeout, requireFreshToken, type NetworkCommandOptions } from './network-options.js';

export interface RepairTagOptions extends NetworkCommandOptions {
  version: string;
}

export async function executeRepairTag(identity: string, options: RepairTagOptions): Promise<unknown> {
  const token = await requireFreshToken(options);
  const server = options.server;
  if (!server) throw new Error('Missing server; run esl login or pass --server');
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    apiUrl(
      server,
      `/api/skills/${encodeURIComponent(identity)}/releases/${encodeURIComponent(options.version)}/repair-tag`
    ),
    { method: 'POST', headers: { Authorization: `token ${token}` } }
  );
  if (!response.ok) {
    throw new Error(`Failed to repair release tag: ${await response.text()}`);
  }
  return response.json();
}
