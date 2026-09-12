import { isBuiltinIdentity, parseSkillName } from '@esl/core';
import { apiUrl, fetchWithTimeout, requireFreshToken, resolveNetworkConfig, type NetworkCommandOptions } from './network-options.js';

export interface DeprecateOptions extends NetworkCommandOptions {
  /** The warning shown to anyone installing this release; an empty message clears the mark. */
  message?: string;
}

export interface DeprecatedRelease {
  skillName: string;
  version: string;
  deprecatedMessage?: string | null;
}

/**
 * Mark a published Skill Release as deprecated (npm deprecate's counterpart), or
 * clear the mark with an empty message. The release stays installable — it just
 * carries a warning.
 */
export async function executeDeprecate(
  identity: string,
  version: string,
  options: DeprecateOptions = {}
): Promise<DeprecatedRelease> {
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
      `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(skillName)}/releases/${encodeURIComponent(version)}/deprecate`
    ),
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: options.message ?? '' })
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to update the release deprecation: ${await response.text()}`);
  }
  return response.json() as Promise<DeprecatedRelease>;
}
