import {
  loadConfig,
  loadCredentials,
  saveConfig,
  type LocalStoreOptions,
  type OrganizationMembership
} from '@esl/core';
import { fetchAccountProfile, fetchMyOrganizations, isLoginFresh, resolveLoginTtlMs } from './network-options.js';

export interface WhoamiOptions extends LocalStoreOptions {
  /**
   * 联网向服务器核实账户资料（邮箱、组织隶属），并把结果写回本地快照。
   * 默认关闭——whoami 的常规语义是「展示本机记录的登录快照」，离线可用。
   */
  online?: boolean;
  customFetch?: typeof fetch;
}

export interface WhoamiResult {
  loggedIn: boolean;
  username: string | null;
  /** 登录时刻记录的用户邮箱快照；token-file 离线登录或旧配置为 null。 */
  email: string | null;
  organizations: OrganizationMembership[] | null;
  /** 旧版（<org>_<username> 时代）配置残留：需要重新登录 */
  legacyIdentity: boolean;
  server: string | null;
  loginAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export async function executeWhoami(options: WhoamiOptions = {}): Promise<WhoamiResult> {
  const config = await loadConfig({ homeDir: options.homeDir });
  const credentials = await loadCredentials({ homeDir: options.homeDir });

  const token = credentials.token;
  const loginAt = credentials.loginAt;
  const loginAtMs = loginAt ? Date.parse(loginAt) : NaN;
  const expired = !isLoginFresh(loginAt);

  let email = config.email ?? null;
  let organizations = config.organizations ?? null;

  if (options.online) {
    if (!token) {
      throw new Error('Not logged in; run esl login to authenticate.');
    }
    if (!config.server) {
      throw new Error('Missing server; run esl config set-server or esl login.');
    }
    const fetchImpl = options.customFetch ?? fetch;
    email = (await fetchAccountProfile(config.server, token, fetchImpl)).email;
    organizations = await fetchMyOrganizations(config.server, token, fetchImpl);
    // 写回本地快照：后续默认（离线）whoami 也反映这次核实到的资料。只更新账户资料，
    // 不碰 loginAt——核实资料不是重新登录，不该延长会话有效期。
    await saveConfig({ email, organizations }, { homeDir: options.homeDir });
  }

  return {
    loggedIn: Boolean(token),
    username: config.username ?? null,
    email,
    organizations,
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
  if (result.email) {
    lines.push(`Email: ${result.email}`);
  }
  if (result.organizations && result.organizations.length > 0) {
    // 括号里是组织内身份（ADR-0038）：所有者成员 / 管理成员 / 普通成员，由常设团队
    // 成员身份推导。组织内没有角色，这里标注的始终是团队身份。
    const rendered = result.organizations
      .map((membership) => `${membership.org} (${membership.identity})`)
      .join(', ');
    lines.push(`Organization memberships: ${rendered}`);
  } else if (result.organizations) {
    lines.push('Organization memberships: none');
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
