import { apiUrl, fetchWithTimeout, requireFreshToken, type NetworkCommandOptions } from './network-options.js';
import { isBuiltinIdentity } from '@esl/core';

export interface RenameOptions extends NetworkCommandOptions {
  newName: string;
}

export async function executeRename(identity: string, options: RenameOptions): Promise<unknown> {
  if (isBuiltinIdentity(identity)) {
    throw new Error(`Unknown built-in skill: ${identity}; built-in skills cannot be renamed`);
  }
  const token = await requireFreshToken(options);
  const server = options.server;
  if (!server) throw new Error('Missing server; run esl login or pass --server');
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    apiUrl(server, `/api/skills/${encodeURIComponent(identity)}/rename`),
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: options.newName })
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to rename skill: ${await response.text()}`);
  }
  return response.json();
}
