import { parseSkillName, isBuiltinIdentity } from '@esl/core';
import { apiUrl, fetchWithTimeout, requireFreshToken, resolveNetworkConfig, type NetworkCommandOptions } from './network-options.js';

export interface ShareOptions extends NetworkCommandOptions {
  all?: boolean;
  team?: string;
  user?: string;
  write?: boolean;
  reset?: boolean;
}

export interface ShareTarget {
  action: 'share_all_read' | 'share_all_write' | 'add_team' | 'add_member' | 'reset_to_private';
  team?: string;
  username?: string;
  permission?: 'read' | 'write';
}

export function resolveShareTarget(options: ShareOptions): ShareTarget {
  const selected = [options.all, options.team, options.user, options.reset].filter(Boolean);
  if (selected.length === 0) {
    throw new Error('Choose one sharing target: --all, --team, --user, or --reset');
  }
  if (selected.length > 1) {
    throw new Error('Choose only one of --all, --team, --user, or --reset');
  }
  if (options.all) {
    return { action: options.write ? 'share_all_write' : 'share_all_read' };
  }
  if (options.team) {
    return { action: 'add_team', team: options.team };
  }
  if (options.user) {
    return { action: 'add_member', username: options.user, permission: options.write ? 'write' : 'read' };
  }
  return { action: 'reset_to_private' };
}

export async function executeShare(identity: string, options: ShareOptions): Promise<unknown> {
  if (isBuiltinIdentity(identity)) {
    throw new Error(`Unknown built-in skill: ${identity}; built-in skills have no permissions to share`);
  }
  const target = resolveShareTarget(options);
  const token = await requireFreshToken(options);
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const { scope, skillName } = parseSkillName(identity);
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    apiUrl(server, `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(skillName)}/permissions`),
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(target)
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to update skill permissions: ${await response.text()}`);
  }
  return response.json();
}
