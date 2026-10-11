import {
  loadConfig,
  initializeLocalStore,
  saveConfig,
  saveCredentials,
  type LocalStoreOptions,
  type OrganizationMembership
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

  // token-file 离线登录拿不到组织/邮箱/locale 这些服务端事实，但"拿不到"不等于
  // 它们失效了。同一账号重登（token 过期后刷新）时旧值仍然有效，保留本地已有值；
  // 换成别的账号则必须清空——否则会拿新 token 配上一个账号的身份，whoami 显示
  // 一个拼接出来的假身份。用户名在平台上全局唯一，是可靠的同一账号判据。
  const keepPreviousIdentity = Boolean(options.tokenFile) && currentConfig.username === username;
  const identity = keepPreviousIdentity
    ? {
        email: currentConfig.email ?? null,
        organizations: currentConfig.organizations ?? null,
        locale: currentConfig.locale ?? null
      }
    : { email, organizations, locale };

  await saveCredentials({ token, loginAt: new Date().toISOString() }, { homeDir: options.homeDir });
  // 显式清掉旧版标记：重新登录后 organizations 已是新形状，提示不该跟着旧配置
  // 一直留在 whoami 输出里。
  await saveConfig(
    { server, username, ...identity, legacyIdentity: false },
    { homeDir: options.homeDir }
  );

  return { token, username, ...identity };
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
    const url = (await readText('Server URL (e.g. http://localhost:3000): ')).trim();
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
