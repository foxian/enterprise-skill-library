import { loadConfig, loadCredentials, type LocalStoreOptions, type OrganizationMembership } from '@esl/core';
import { isLoginFresh, resolveLoginTtlMs } from './network-options.js';

export interface WhoamiResult {
  loggedIn: boolean;
  username: string | null;
  organizations: OrganizationMembership[] | null;
  /** 旧版（<org>_<username> 时代）配置残留：需要重新登录 */
  legacyIdentity: boolean;
  server: string | null;
  loginAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export async function executeWhoami(options: LocalStoreOptions = {}): Promise<WhoamiResult> {
  const config = await loadConfig({ homeDir: options.homeDir });
  const credentials = await loadCredentials({ homeDir: options.homeDir });

  const token = credentials.token;
  const loginAt = credentials.loginAt;
  const loginAtMs = loginAt ? Date.parse(loginAt) : NaN;
  const expired = !isLoginFresh(loginAt);

  return {
    loggedIn: Boolean(token),
    username: config.username ?? null,
    organizations: config.organizations ?? null,
    legacyIdentity: config.legacyIdentity ?? false,
    server: config.server ?? null,
    loginAt,
    expiresAt: loginAt && !Number.isNaN(loginAtMs) ? new Date(loginAtMs + resolveLoginTtlMs()).toISOString() : null,
    expired
  };
}

export function formatWhoami(result: WhoamiResult): string {
  if (!result.loggedIn) {
    return 'Not logged in. Run esl login to authenticate.';
  }
  const lines: string[] = [];
  if (result.legacyIdentity) {
    lines.push('Notice: this login predates the global identity model; run `esl login` again.');
  }
  if (result.username) {
    lines.push(`Username: ${result.username}`);
  }
  if (result.organizations && result.organizations.length > 0) {
    // `(manager)` = 是该组织管理团队（= Gitea Owners）成员，即持有该组织治理权
    // （ADR-0033）。组织内没有角色，这里标注的是团队身份。
    const rendered = result.organizations
      .map((membership) => (membership.isOrgManager ? `${membership.org} (manager)` : membership.org))
      .join(', ');
    lines.push(`Organizations: ${rendered}`);
  } else if (result.organizations) {
    lines.push('Organizations: none');
  }
  if (result.server) {
    lines.push(`Server: ${result.server}`);
  }
  if (result.loginAt) {
    lines.push(`Logged in at: ${result.loginAt}`);
  }
  if (result.expiresAt) {
    lines.push(`Expires at: ${result.expiresAt}`);
  }
  lines.push(result.expired ? 'Status: expired (run esl login to re-authenticate)' : 'Status: active');
  return lines.join('\n');
}
