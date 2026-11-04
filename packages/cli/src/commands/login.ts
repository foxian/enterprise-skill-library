import {
  accountForInstance,
  addPendingServerAddress,
  addServerAddress,
  discoverServerIdentity,
  findServerInstanceByAddress,
  findServerInstanceById,
  loadConfig,
  initializeLocalStore,
  normalizeServerUrl,
  saveConfig,
  saveCredentials,
  type InstanceAccountSnapshot,
  type LocalStoreOptions,
  type OrganizationMembership,
  type ServerRegistry
} from '@esl/core';
import { resolveLocale, translateApiError } from '@esl/i18n';
import fs from 'node:fs/promises';
import { isInteractive, readHidden, readText } from '../prompt.js';
import { resolveServer } from './config.js';
import { fetchAccountProfile, fetchWithTimeout } from './network-options.js';

export interface LoginOptions extends LocalStoreOptions {
  server?: string;
  username?: string;
  passwordFile?: string;
  tokenFile?: string;
  locale?: string | null;
  noInput?: boolean;
  readInput?: () => Promise<string>;
  readServer?: () => Promise<string>;
  readUsername?: (prompt: string) => Promise<string>;
  customFetch?: typeof fetch;
}

export interface LoginResult {
  token: string;
  username: string;
  /** token-file 换账号重登时为 null（未知）；密码登录恒为数组。 */
  organizations: OrganizationMembership[] | null;
  locale?: string | null;
  /**
   * 登录时刻的用户邮箱快照。密码登录后调 /api/account/profile 取得；
   * token-file 离线登录沿用本地已有值，换账号时为 null。
   */
  email?: string | null;
}

// 全局身份登录（ADR-0032）：username + password 一条凭据，无组织输入；
// 所属组织列表由服务端按 Gitea 成员关系派生。
export async function executeLogin(options: LoginOptions): Promise<LoginResult> {
  const fetchImpl = options.customFetch ?? fetch;
  await initializeLocalStore({ homeDir: options.homeDir });
  const currentConfig = await loadConfig({ homeDir: options.homeDir });
  const activeLocale = resolveLocale({
    override: options.locale,
    accountLocale: currentConfig.locale
  });

  const server = await resolveServerForLogin(options);
  const username = await resolveUsername(options);
  const { token, organizations, locale, email } = await resolveLoginToken(
    options,
    server,
    username,
    fetchImpl,
    activeLocale
  );

  // 登录后尽力登记来源实例：登录本身不依赖身份发现（Server 可能暂时不可达），
  // 但发现成功时把凭据按实例保存，并缓存地址与 Instance ID 的绑定。
  // token-file 登录完全不联网，但仍可复用本地已确认的地址绑定。
  const currentRegistry: ServerRegistry = {
    instances: currentConfig.servers ?? [],
    selectedInstanceId: currentConfig.selectedInstanceId ?? null,
    pendingAddresses: currentConfig.pendingServerAddresses ?? []
  };
  const localBinding = findServerInstanceByAddress(currentRegistry, normalizeServerUrl(server));
  const instanceId = options.tokenFile
    ? localBinding?.instance.instanceId ?? null
    : await registerInstanceAfterLogin(options, server, fetchImpl);

  // token-file 离线登录拿不到组织/邮箱/locale 这些服务端事实，但"拿不到"不等于
  // 它们失效了。同一实例、同一账号重登（token 过期后刷新）时旧值仍然有效；
  // 换成别的账号则必须清空——否则会拿新 token 配上一个账号的身份。
  const previousSnapshot = instanceId
    ? accountForInstance(currentConfig, instanceId)
    : {
        username: currentConfig.username,
        email: currentConfig.email ?? null,
        organizations: currentConfig.organizations,
        locale: currentConfig.locale ?? null
      };
  const keepPreviousIdentity =
    Boolean(options.tokenFile) && previousSnapshot?.username === username;
  const identity = keepPreviousIdentity
    ? {
        email: previousSnapshot?.email ?? null,
        organizations: previousSnapshot?.organizations ?? null,
        locale: previousSnapshot?.locale ?? null
      }
    : { email, organizations, locale };
  const accountSnapshot: InstanceAccountSnapshot = {
    username,
    email: identity.email ?? null,
    organizations: identity.organizations ?? null,
    locale: identity.locale ?? null,
    legacyIdentity: false
  };

  await saveCredentials(
    {
      token,
      loginAt: new Date().toISOString(),
      address: normalizeServerUrl(server),
      ...(instanceId ? { instanceId } : {})
    },
    { homeDir: options.homeDir }
  );
  // 显式清掉旧版标记：重新登录后 organizations 已是新形状，提示不该跟着旧配置
  // 一直留在 whoami 输出里。账户快照按实例保存，顶层字段仅作为兼容视图。
  const nextInstanceAccounts = instanceId
    ? { ...(currentConfig.instanceAccounts ?? {}), [instanceId]: accountSnapshot }
    : currentConfig.instanceAccounts;
  const pendingLogin =
    !instanceId && (currentConfig.servers?.length ?? 0) > 0
      ? addPendingServerAddress(currentRegistry, { url: server })
      : null;
  await saveConfig(
    {
      server,
      username,
      ...identity,
      legacyIdentity: false,
      ...(nextInstanceAccounts ? { instanceAccounts: nextInstanceAccounts } : {}),
      ...(pendingLogin
        ? {
            selectedInstanceId: null,
            pendingServerAddresses: pendingLogin.registry.pendingAddresses ?? []
          }
        : {})
    },
    { homeDir: options.homeDir }
  );

  return { token, username, ...identity };
}

async function registerInstanceAfterLogin(
  options: LoginOptions,
  server: string,
  fetchImpl: typeof fetch
): Promise<string | null> {
  try {
    const identity = await discoverServerIdentity(server, { fetchImpl, timeoutMs: 2_000 });
    const config = await loadConfig({ homeDir: options.homeDir });
    const registry: ServerRegistry = {
      instances: config.servers ?? [],
      selectedInstanceId: config.selectedInstanceId ?? null,
      pendingAddresses: config.pendingServerAddresses ?? []
    };
    const binding = findServerInstanceByAddress(registry, normalizeServerUrl(server));
    if (binding && binding.instance.instanceId !== identity.instanceId) {
      // 已登记地址换了身份：不把新凭据写进旧实例，也不静默改绑。
      throw new Error(
        `Address ${server} is registered to ESL Server instance ${binding.instance.instanceId}, ` +
          `but it now reports ${identity.instanceId}. Refusing to store credentials against ` +
          `a silently rebound address; remove the old registration first ("esl config server remove ${server}").`
      );
    }
    if (binding) {
      // 登录到已确认地址：当前地址即当前实例，同步 selectedInstanceId。
      await saveConfig(
        {
          servers: registry.instances,
          selectedInstanceId: binding.instance.instanceId,
          pendingServerAddresses: registry.pendingAddresses ?? []
        },
        { homeDir: options.homeDir }
      );
      return binding.instance.instanceId;
    }
    if (findServerInstanceById(registry, identity.instanceId)) {
      // 新地址声明已知实例：登录不替用户做地址确认，保持未登记。
      return identity.instanceId;
    }
    const registration = addServerAddress(registry, {
      instanceId: identity.instanceId,
      url: server,
      select: true
    });
    await saveConfig(
      {
        servers: registration.registry.instances,
        selectedInstanceId: registration.registry.selectedInstanceId,
        pendingServerAddresses: registration.registry.pendingAddresses ?? []
      },
      { homeDir: options.homeDir }
    );
    return identity.instanceId;
  } catch {
    return null;
  }
}

// 首次使用未配置 server 时交互式询问并记住;非交互环境直接报错。
async function resolveServerForLogin(options: LoginOptions): Promise<string> {
  try {
    return await resolveServer({ server: options.server, homeDir: options.homeDir });
  } catch (error) {
    if (options.noInput) {
      throw error;
    }
    if (options.readServer) {
      const url = (await options.readServer()).trim();
      if (!url) {
        throw error;
      }
      return url;
    }
    if (!isInteractive()) {
      throw error;
    }
    const url = (await readText('Server URL (e.g. http://localhost:4070): ')).trim();
    if (!url) {
      throw error;
    }
    return url;
  }
}

async function resolveUsername(options: LoginOptions): Promise<string> {
  if (options.username) {
    return options.username;
  }
  if (options.noInput) {
    throw new Error('A username is required; pass --username or run interactively');
  }
  if (options.readUsername) {
    return (await options.readUsername('Username: ')).trim();
  }
  if (!isInteractive()) {
    throw new Error('A username is required; pass --username or run interactively');
  }
  return (await readText('Username: ')).trim();
}

async function resolveLoginToken(
  options: LoginOptions,
  server: string,
  username: string,
  fetchImpl: typeof fetch,
  locale: 'zh-CN' | 'en-US'
): Promise<{
  token: string;
  organizations: OrganizationMembership[];
  locale: string | null;
  email: string | null;
}> {
  if (options.tokenFile) {
    const token = (await fs.readFile(options.tokenFile, 'utf8')).trim();
    if (!token) {
      throw new Error(`Token file ${options.tokenFile} is empty`);
    }
    // token-file 登录不联网,拿不到成员关系与邮箱;组织列表、邮箱留空,whoami/status
    // 以本地已有信息展示。
    return { token, organizations: [], locale: null, email: null };
  }

  const password = options.passwordFile
    ? (await fs.readFile(options.passwordFile, 'utf8')).trim()
    : await promptForPassword(options);

  if (!password) {
    throw new Error('Password is required for login');
  }

  const exchanged = await exchangePasswordForToken(server, username, password, fetchImpl, locale);
  // 登录接口本身不返邮箱（契约与 Web 端共用，不为 CLI 扩字段）；换 token 成功后
  // 再取一次账户资料。该调用只增强 whoami 展示，任何失败都降级为 null，不拖垮登录。
  const email = await fetchAccountEmail(server, exchanged.token, fetchImpl);
  return { ...exchanged, email };
}

// 取登录用户的邮箱快照。合成邮箱（user@local.esl，邮箱待补全的存量账号）由服务端
// 原样返回，这里也原样保存。任何失败（网络、非 2xx、畸形 JSON）都降级为 null：
// 邮箱只增强 whoami 展示，不该把登录主流程绑在第二个接口的可用性上。
async function fetchAccountEmail(
  server: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<string | null> {
  try {
    return (await fetchAccountProfile(server, token, fetchImpl)).email;
  } catch {
    return null;
  }
}

async function promptForPassword(options: LoginOptions): Promise<string> {
  if (options.noInput) {
    throw new Error('Login requires a password or token; pass --password-file or --token-file when using --no-input');
  }
  if (options.readInput) {
    return (await options.readInput()).trim();
  }
  if (!isInteractive()) {
    throw new Error('Login requires a password; run interactively or pass --password-file/--token-file');
  }
  return (await readHidden('Password: ')).trim();
}

async function exchangePasswordForToken(
  server: string,
  username: string,
  password: string,
  fetchImpl: typeof fetch,
  locale: 'zh-CN' | 'en-US'
): Promise<{
  token: string;
  organizations: OrganizationMembership[];
  locale: string | null;
}> {
  const base = server.replace(/\/$/, '');
  const res = await fetchWithTimeout(fetchImpl, `${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) {
    const err = await res.text();
    try {
      const body = JSON.parse(err) as {
        code?: string;
        params?: Record<string, string>;
        message?: string;
      };
      if (typeof body.code === 'string') {
        throw new Error(
          translateApiError({
            locale,
            code: body.code,
            params: body.params,
            fallback: body.message ?? 'Failed to authenticate with ESL Server'
          })
        );
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
    throw new Error(`Failed to authenticate with ESL Server: ${err}`);
  }

  const data = (await res.json()) as {
    token: string;
    organizations?: OrganizationMembership[];
    locale?: string | null;
  };
  return {
    token: data.token,
    organizations: Array.isArray(data.organizations) ? data.organizations : [],
    locale: data.locale ?? null
  };
}
