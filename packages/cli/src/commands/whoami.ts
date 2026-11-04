import {
  accountForInstance,
  credentialsForInstance,
  loadConfig,
  loadCredentials,
  saveConfig,
  serverContextOfConfig,
  type InstanceAccountSnapshot,
  type LocalStoreOptions,
  type OrganizationMembership,
  type ServerIdentityStatus
} from '@esl/core';
import { fetchAccountProfile, fetchMyOrganizations, isLoginFresh, resolveLoginTtlMs } from './network-options.js';
import { resolveServer } from './config.js';

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
  /** 当前地址的身份状态；unconfirmed 时不得把本地凭据当作已登录。 */
  identityStatus: ServerIdentityStatus;
  instanceId: string | null;
  hasRegisteredInstances: boolean;
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
  const allCredentials = await loadCredentials({ homeDir: options.homeDir });
  const context = serverContextOfConfig(config);
  const hasRegistry =
    (config.servers?.length ?? 0) > 0 || (config.pendingServerAddresses?.length ?? 0) > 0;

  const identityStatus: ServerIdentityStatus = context.status;
  let credentials = { token: null as string | null, loginAt: null as string | null };
  let snapshot: InstanceAccountSnapshot | null = null;

  if (identityStatus === 'confirmed' && context.instanceId) {
    // 已确认实例只读该实例的凭据与账户快照，绝不回退到顶层遗留值。
    credentials = credentialsForInstance(allCredentials, context.instanceId);
    snapshot = accountForInstance(config, context.instanceId);
  } else if (identityStatus === 'legacy' || (identityStatus === 'none' && !hasRegistry)) {
    credentials = credentialsForInstance(allCredentials, null);
    snapshot = {
      username: config.username,
      email: config.email ?? null,
      organizations: config.organizations,
      locale: config.locale ?? null,
      legacyIdentity: config.legacyIdentity ?? false
    };
  }
  // unconfirmed：不读取任何凭据或账户快照，状态保持未知。

  const loginAt = credentials.loginAt;
  const loginAtMs = loginAt ? Date.parse(loginAt) : NaN;
  const expired = !isLoginFresh(loginAt);
  let email = snapshot?.email ?? null;
  let organizations = snapshot?.organizations ?? null;
  let server = context.server ?? config.server ?? null;

  if (options.online) {
    if (identityStatus === 'unconfirmed') {
      throw new Error(
        `The ESL Server identity at ${server ?? 'the configured address'} is not confirmed. ` +
          'Register or confirm the address with "esl config server list" before authenticating.'
      );
    }
    if (!credentials.token) {
      throw new Error(
        identityStatus === 'confirmed'
          ? 'The current ESL Server is not logged in; run esl login to authenticate.'
          : 'Not logged in; run esl login to authenticate.'
      );
    }
    server = context.server ?? (await resolveServer({ homeDir: options.homeDir }));
    const fetchImpl = options.customFetch ?? fetch;
    email = (await fetchAccountProfile(server, credentials.token, fetchImpl)).email;
    organizations = await fetchMyOrganizations(server, credentials.token, fetchImpl);

    const nextSnapshot: InstanceAccountSnapshot = {
      username: snapshot?.username ?? null,
      email,
      organizations,
      locale: snapshot?.locale ?? config.locale ?? null,
      legacyIdentity: snapshot?.legacyIdentity ?? false
    };
    // 写回当前实例快照：后续默认（离线）whoami 也反映这次核实到的资料。只更新
    // 账户资料，不碰 loginAt——核实资料不是重新登录，不该延长会话有效期。
    await saveConfig(
      {
        email,
        organizations,
        ...(identityStatus === 'confirmed' && context.instanceId
          ? {
              instanceAccounts: {
                ...(config.instanceAccounts ?? {}),
                [context.instanceId]: nextSnapshot
              }
            }
          : {})
      },
      { homeDir: options.homeDir }
    );
  }

  return {
    loggedIn: identityStatus === 'unconfirmed' ? false : Boolean(credentials.token),
    identityStatus,
    instanceId: context.instanceId,
    hasRegisteredInstances: hasRegistry,
    username: snapshot?.username ?? null,
    email,
    organizations,
    legacyIdentity: snapshot?.legacyIdentity ?? false,
    server,
    loginAt,
    expiresAt: loginAt && !Number.isNaN(loginAtMs) ? new Date(loginAtMs + resolveLoginTtlMs()).toISOString() : null,
    expired
  };
}

export function formatWhoami(result: WhoamiResult): string {
  if (result.identityStatus === 'unconfirmed') {
    const lines = [`Server: ${result.server ?? '(unknown)'}`];
    lines.push('Status: identity unconfirmed');
    lines.push(
      'The current Server address is not bound to a confirmed instance. Authenticating commands stop until you confirm it with "esl config server list".'
    );
    return lines.join('\n');
  }
  if (result.identityStatus === 'none' && result.hasRegisteredInstances) {
    return 'No ESL Server address selected. Run "esl config server list" to choose an address.';
  }
  if (!result.loggedIn) {
    return result.identityStatus === 'confirmed'
      ? `Not logged in to the current ESL Server (${result.server ?? 'unknown'}). Run esl login to authenticate.`
      : 'Not logged in. Run esl login to authenticate.';
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
