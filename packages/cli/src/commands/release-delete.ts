import { isBuiltinIdentity, parseSkillName } from '@esl/core';
import { apiUrl, fetchWithTimeout, requireFreshToken, resolveNetworkConfig, type NetworkCommandOptions } from './network-options.js';

export interface ReleaseDeleteOptions extends NetworkCommandOptions {
  /** Must equal the version being deleted — the server's explicit-confirmation contract. */
  confirm?: string;
  /** Overrides the dependency-pinning guard; requires a platform administrator on the server. */
  force?: boolean;
}

export interface DeletedRelease {
  deleted: boolean;
  name: string;
  version: string;
  dependents: string[];
}

/**
 * Delete a single Skill Release (CONTEXT:单版本删除). The version number stays burned,
 * so this is a deliberate, hard-to-undo action: the caller has to echo the version.
 *
 * A release other skills pin through their Release Dependency Lock is refused unless
 * `force` is passed, and the server only accepts that from a platform administrator.
 */
export async function executeReleaseDelete(
  identity: string,
  version: string,
  options: ReleaseDeleteOptions = {}
): Promise<DeletedRelease> {
  if (isBuiltinIdentity(identity)) {
    throw new Error(`Unknown built-in skill: ${identity}; built-in skills have no releases`);
  }
  if (options.confirm !== version) {
    throw new Error(
      `Deleting ${identity}@${version} requires an explicit confirmation: pass --confirm ${version} (the version number is burned and cannot be republished).`
    );
  }
  const token = await requireFreshToken(options);
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const { scope, skillName } = parseSkillName(identity);
  const fetchImpl = options.customFetch ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    apiUrl(
      server,
      `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(skillName)}/releases/${encodeURIComponent(version)}/delete`
    ),
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options.force ? { confirm: version, force: true } : { confirm: version })
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to delete the release: ${await response.text()}`);
  }
  return response.json() as Promise<DeletedRelease>;
}
