import { parseSkillName, isBuiltinIdentity } from '@esl/core';
import { apiUrl, fetchWithTimeout, requireFreshToken, resolveNetworkConfig, type NetworkCommandOptions } from './network-options.js';
import { confirm, isInteractive, readText } from '../prompt.js';

export interface DeleteOptions extends NetworkCommandOptions {
  yes?: boolean;
  noInput?: boolean;
  confirmInput?: () => Promise<boolean>;
}

export interface DeletedSkill {
  deleted: boolean;
  name: string;
  skillId?: string;
  releasesRemoved?: number;
}

export async function executeDelete(identity: string, options: DeleteOptions): Promise<DeletedSkill> {
  if (isBuiltinIdentity(identity)) {
    throw new Error(`Unknown built-in skill: ${identity}; built-in skills cannot be deleted`);
  }
  await confirmDelete(identity, options);
  const token = await requireFreshToken(options);
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const { scope, skillName } = parseSkillName(identity);
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    apiUrl(server, `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(skillName)}/delete`),
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ confirm: identity })
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to delete skill: ${await response.text()}`);
  }
  return response.json() as Promise<DeletedSkill>;
}

async function confirmDelete(identity: string, options: DeleteOptions): Promise<void> {
  if (options.yes) {
    return;
  }
  if (options.noInput) {
    throw new Error('Deleting a skill requires confirmation; pass --yes to skip it');
  }
  const confirmFn =
    options.confirmInput ??
    (async () => {
      if (!isInteractive()) {
        throw new Error('Deleting a skill requires confirmation in an interactive terminal; pass --yes to skip');
      }
      // Double confirmation: an explicit yes, then retyping the full identity so
      // accidental deletion cannot be triggered by a stray "y".
      const first = await confirm(`Permanently delete ${identity}? This cannot be undone. [y/N] `);
      if (!first) {
        return false;
      }
      const typed = (await readText(`Type "${identity}" to confirm deletion: `)).trim();
      return typed === identity;
    });
  const confirmed = await confirmFn();
  if (!confirmed) {
    throw new Error('Delete cancelled');
  }
}
