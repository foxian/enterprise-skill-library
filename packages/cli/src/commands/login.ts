import { initializeLocalStore, saveConfig, saveCredentials, type LocalStoreOptions } from '@esl/core';
import fs from 'node:fs/promises';
import { isInteractive, readHidden, readText } from '../prompt.js';
import { resolveServer } from './config.js';
import { fetchWithTimeout } from './network-options.js';

export interface LoginOptions extends LocalStoreOptions {
  server?: string;
  username?: string;
  org?: string;
  passwordFile?: string;
  tokenFile?: string;
  noInput?: boolean;
  readInput?: () => Promise<string>;
  readServer?: () => Promise<string>;
  readUsername?: (prompt: string) => Promise<string>;
  readOrg?: (prompt: string) => Promise<string>;
  customFetch?: typeof fetch;
}

export interface LoginResult {
  token: string;
  username: string;
  org: string;
  role: 'org-admin' | 'member';
}

export async function executeLogin(options: LoginOptions): Promise<LoginResult> {
  const fetchImpl = options.customFetch ?? fetch;
  await initializeLocalStore({ homeDir: options.homeDir });

  const server = await resolveServerForLogin(options);
  const org = await resolveOrg(options, server, fetchImpl);
  const username = await resolveUsername(options);
  const { token, role } = await resolveLoginToken(options, server, org, username, fetchImpl);

  await saveCredentials({ token, loginAt: new Date().toISOString() }, { homeDir: options.homeDir });
  await saveConfig(
    {
      server,
      username,
      org,
      role
    },
    { homeDir: options.homeDir }
  );

  // 返回解析后的身份,供调用方打印准确的登录成功信息(org 可能由默认组织
  // 自动解析而非显式 --org 提供)。
  return { token, username, org, role };
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

async function resolveOrg(options: LoginOptions, server: string, fetchImpl: typeof fetch): Promise<string> {
  // 显式 --org 始终覆盖默认组织,且无需询问平台信息。
  if (options.org) {
    return options.org.trim();
  }
  // 平台设有默认组织时(任何模式)跳过组织提示,按默认组织登录(ADR-0022)。
  const defaultOrg = await fetchDefaultOrg(server, fetchImpl);
  if (defaultOrg) {
    return defaultOrg;
  }
  if (options.noInput) {
    throw new Error('An organization is required; pass --org or run interactively');
  }
  if (options.readOrg) {
    return (await options.readOrg('Organization: ')).trim();
  }
  if (!isInteractive()) {
    throw new Error('An organization is required; pass --org or run interactively');
  }
  const org = (await readText('Organization: ')).trim();
  if (!org) {
    throw new Error('An organization is required');
  }
  return org;
}

// 登录前查询平台信息拿默认组织;平台信息不可用或未设默认组织时返回 null,
// 退回原交互(不阻断登录——认证失败本身会给出错误)。
async function fetchDefaultOrg(server: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const base = server.replace(/\/$/, '');
    const res = await fetchWithTimeout(fetchImpl, `${base}/api/public/platform-info`, { method: 'GET' });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { defaultOrg?: string | null };
    return typeof data.defaultOrg === 'string' && data.defaultOrg ? data.defaultOrg : null;
  } catch {
    return null;
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
  org: string,
  username: string,
  fetchImpl: typeof fetch
): Promise<{ token: string; role: 'org-admin' | 'member' }> {
  if (options.tokenFile) {
    const token = (await fs.readFile(options.tokenFile, 'utf8')).trim();
    if (!token) {
      throw new Error(`Token file ${options.tokenFile} is empty`);
    }
    // token-file 登录不联网,角色按命名约定推导(仅展示用)
    return { token, role: username === 'admin' ? 'org-admin' : 'member' };
  }

  const password = options.passwordFile
    ? (await fs.readFile(options.passwordFile, 'utf8')).trim()
    : await promptForPassword(options);

  if (!password) {
    throw new Error('Password is required for login');
  }

  return exchangePasswordForToken(server, org, username, password, fetchImpl);
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
  org: string,
  username: string,
  password: string,
  fetchImpl: typeof fetch
): Promise<{ token: string; role: 'org-admin' | 'member' }> {
  const base = server.replace(/\/$/, '');
  const res = await fetchWithTimeout(fetchImpl, `${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ org, username, password })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to authenticate with ESL Server: ${err}`);
  }

  const data = (await res.json()) as { token: string; role?: string };
  const role = data.role === 'org-admin' || data.role === 'member' ? data.role : username === 'admin' ? 'org-admin' : 'member';
  return { token: data.token, role };
}
